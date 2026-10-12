import type { ApiClient, Order } from "@restaurant/api-client";
import { io, type Socket } from "socket.io-client";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline";

export interface RealtimeHandlers {
  onStatus: (s: RealtimeStatus) => void;
  onOrder: (event: "order.created" | "order.updated", order: Order) => void;
  /** Reconnexion après une coupure : des événements ont pu être manqués. */
  onResync: () => void;
  onOther?: (event: string, payload: unknown) => void;
}

export interface RealtimeOptions {
  /** Origine du serveur (même origine en dev grâce au proxy Vite). */
  origin: string;
  client: Pick<ApiClient, "getAccessToken" | "hasRefreshToken" | "refresh">;
  handlers: RealtimeHandlers;
  /** Fabrique injectable (tests). */
  connect?: typeof io;
}

/** Origine du serveur temps réel à partir du préfixe d'API (`/api/v1` ou `https://api.exemple.com/api/v1`). */
export function realtimeOrigin(apiBase: string, location?: { origin: string }): string {
  if (/^https?:\/\//.test(apiBase)) return new URL(apiBase).origin;
  return (location ?? globalThis.location).origin;
}

/** Attente avant de retenter après un refus d'authentification : 1 s, 2 s, 4 s… plafonnée à 30 s. */
export const authRetryDelay = (failures: number) => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));

/**
 * Connexion Socket.io à l'espace de noms `/realtime` d'un restaurant.
 * - le jeton d'accès est lu à chaque tentative (`auth` en fonction) : une reconnexion utilise le jeton le plus récent ;
 * - `auth_error` (jeton expiré…) : le serveur coupe la socket ; on rafraîchit le jeton via le client HTTP
 *   (rotation partagée avec les requêtes en cours) puis on se reconnecte, avec un délai croissant ;
 * - après toute reconnexion, `onResync` recharge les vues de service.
 */
export class RealtimeConnection {
  private socket: Socket | null = null;
  private stopped = true;
  private everReady = false;
  private authFailures = 0;
  private needsRefresh = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private status: RealtimeStatus = "idle";

  constructor(private readonly opts: RealtimeOptions) {}

  private setStatus(s: RealtimeStatus) {
    if (s === this.status) return;
    this.status = s;
    this.opts.handlers.onStatus(s);
  }

  getStatus() { return this.status; }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus("connecting");
    const make = this.opts.connect ?? io;
    const socket = make(`${this.opts.origin}/realtime`, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      auth: (cb: (data: object) => void) => cb({ token: this.opts.client.getAccessToken() ?? "" }),
    });
    this.socket = socket;

    socket.on("ready", () => {
      const wasReady = this.everReady;
      this.everReady = true;
      this.authFailures = 0;
      this.needsRefresh = false;
      this.setStatus("connected");
      if (wasReady) this.opts.handlers.onResync();
    });
    socket.on("auth_error", () => {
      this.authFailures += 1;
      this.needsRefresh = true;
    });
    socket.on("disconnect", (reason) => {
      if (this.stopped) return;
      this.setStatus(this.everReady ? "reconnecting" : "connecting");
      // Déconnexion décidée par le serveur (refus d'authentification) : Socket.io ne retente pas seul.
      if (reason === "io server disconnect") this.scheduleReconnect();
    });
    socket.on("connect_error", () => {
      if (this.stopped) return;
      this.setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : this.everReady ? "reconnecting" : "connecting");
    });
    socket.on("order.created", (o: Order) => this.opts.handlers.onOrder("order.created", o));
    socket.on("order.updated", (o: Order) => this.opts.handlers.onOrder("order.updated", o));
    socket.onAny((event: string, payload: unknown) => {
      if (event !== "order.created" && event !== "order.updated" && event !== "ready" && event !== "auth_error") this.opts.handlers.onOther?.(event, payload);
    });

    await this.ensureToken();
    if (!this.stopped) socket.connect();
  }

  private async ensureToken(force = false): Promise<boolean> {
    const c = this.opts.client;
    if (!force && c.getAccessToken()) return true;
    if (!c.hasRefreshToken()) return false;
    try { return await c.refresh(); } catch { return false; }   // réseau coupé : on retentera
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.stopped) return;
    const delay = this.needsRefresh ? authRetryDelay(this.authFailures) : 1000;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (this.stopped) return;
      if (this.needsRefresh) {
        const ok = await this.ensureToken(true);
        // Session terminée (refresh refusé) : le client HTTP émet `session-ended`, l'app revient à la connexion.
        if (!ok && !this.opts.client.hasRefreshToken()) { this.stop(); return; }
      }
      if (!this.stopped) this.socket?.connect();
    }, delay);
  }

  /** Forcer une reconnexion immédiate (bouton « Reconnecter »). */
  reconnectNow() {
    if (this.stopped || !this.socket) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.socket.connected) return;
    void this.ensureToken().then(() => { if (!this.stopped) this.socket?.connect(); });
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.socket?.removeAllListeners();
    this.socket?.offAny();
    this.socket?.disconnect();
    this.socket = null;
    this.everReady = false;
    this.setStatus("idle");
  }
}
