import { ApiError } from "./errors";

export type Space = "platform" | "tenant";

/** Où vit le jeton de rafraîchissement (le jeton d'accès, lui, reste en mémoire). */
export interface TokenStorage {
  get(): string | null;
  set(token: string | null): void;
}

/**
 * Stockage dans localStorage. Compromis assumé : un script injecté (XSS) pourrait lire le jeton.
 * Un cookie HttpOnly posé par l'API serait plus sûr (évolution prévue côté serveur).
 */
export function localStorageTokenStorage(key: string): TokenStorage {
  return {
    get() {
      try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
    },
    set(token) {
      try {
        if (token) globalThis.localStorage?.setItem(key, token);
        else globalThis.localStorage?.removeItem(key);
      } catch { /* stockage indisponible (navigation privée…) : la session reste en mémoire */ }
    },
  };
}

export function memoryTokenStorage(initial: string | null = null): TokenStorage {
  let value = initial;
  return { get: () => value, set: (t) => { value = t; } };
}

export type ClientEvent =
  | { type: "session-ended"; reason: ApiError | null }
  | { type: "error"; error: ApiError }
  | { type: "tokens"; accessToken: string | null };

export interface ApiClientOptions {
  /** Préfixe des routes, ex. `/api/v1` (proxy Vite) ou `https://api.monapp.com/api/v1`. */
  baseUrl: string;
  space: Space;
  storage: TokenStorage;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** `false` pour les routes publiques (pas d'en-tête Authorization ni de rafraîchissement). */
  auth?: boolean;
  signal?: AbortSignal;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Client HTTP d'un espace (plateforme ou restaurant) :
 * - ajoute le jeton d'accès (gardé en mémoire uniquement) ;
 * - sur 401, fait tourner le refresh token UNE seule fois même si plusieurs requêtes échouent en même temps,
 *   puis rejoue la requête ;
 * - si le rafraîchissement échoue, efface la session et émet `session-ended`.
 */
export class ApiClient {
  readonly space: Space;
  private readonly baseUrl: string;
  private readonly storage: TokenStorage;
  private readonly fetchImpl: typeof fetch;
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private readonly listeners = new Set<(e: ClientEvent) => void>();

  constructor(opts: ApiClientOptions) {
    this.space = opts.space;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.storage = opts.storage;
    this.fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  }

  // ── session ──

  subscribe(listener: (e: ClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(e: ClientEvent) {
    for (const l of [...this.listeners]) l(e);
  }

  /** Après une connexion réussie. */
  setSession(tokens: SessionTokens) {
    this.accessToken = tokens.accessToken;
    this.storage.set(tokens.refreshToken);
    this.emit({ type: "tokens", accessToken: tokens.accessToken });
  }

  /** Efface la session locale (sans appel réseau). */
  clearSession() {
    this.accessToken = null;
    this.storage.set(null);
    this.emit({ type: "tokens", accessToken: null });
  }

  hasRefreshToken(): boolean {
    return !!this.storage.get();
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Ferme la session côté serveur puis localement. */
  async logout(): Promise<void> {
    const refreshToken = this.storage.get();
    this.clearSession();
    if (refreshToken) {
      await this.raw("POST", `/${this.space}/auth/logout`, { body: { refreshToken }, auth: false }).catch(() => undefined);
    }
  }

  /**
   * Fait tourner le refresh token. Un seul appel réseau à la fois : les appelants concurrents
   * partagent la même promesse. Retourne `false` (et termine la session) en cas d'échec.
   */
  refresh(): Promise<boolean> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const used = this.storage.get();
    if (!used) return false;
    try {
      const res = await this.raw<SessionTokens>("POST", `/${this.space}/auth/refresh`, { body: { refreshToken: used }, auth: false });
      this.setSession(res);
      return true;
    } catch (e) {
      const err = e instanceof ApiError ? e : ApiError.network(e);
      if (err.status === 0) throw err;   // réseau coupé : on garde la session, l'appelant affichera l'erreur
      // Un autre onglet a peut-être déjà fait tourner le jeton : on retente avec la nouvelle valeur.
      const current = this.storage.get();
      if (current && current !== used) {
        try {
          const res = await this.raw<SessionTokens>("POST", `/${this.space}/auth/refresh`, { body: { refreshToken: current }, auth: false });
          this.setSession(res);
          return true;
        } catch { /* on termine la session ci-dessous */ }
      }
      this.clearSession();
      this.emit({ type: "session-ended", reason: err });
      if (err.isLicenseBlocked) this.emit({ type: "error", error: err });
      return false;
    }
  }

  // ── requêtes ──

  get<T>(path: string, opts?: Omit<RequestOptions, "body">) { return this.request<T>("GET", path, opts); }
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) { return this.request<T>("POST", path, { ...opts, body }); }
  patch<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "body">) { return this.request<T>("PATCH", path, { ...opts, body }); }
  delete<T>(path: string, opts?: Omit<RequestOptions, "body">) { return this.request<T>("DELETE", path, opts); }

  /** Envoi multipart d'un fichier (champ `file` par défaut). */
  upload<T>(path: string, file: Blob, opts: { field?: string; filename?: string; signal?: AbortSignal } = {}) {
    const form = new FormData();
    const name = opts.filename ?? (file instanceof File ? file.name : "file");
    form.append(opts.field ?? "file", file, name);
    return this.request<T>("POST", path, { body: form, signal: opts.signal });
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth !== false;
    // Page rechargée : pas encore de jeton d'accès, mais un refresh token → on rafraîchit d'abord.
    if (auth && !this.accessToken && this.storage.get()) await this.refresh();

    try {
      return await this.raw<T>(method, path, opts);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (auth && e.status === 401 && this.storage.get()) {
        const ok = await this.refresh();
        if (ok) {
          try { return await this.raw<T>(method, path, opts); } catch (e2) {
            if (e2 instanceof ApiError) this.emit({ type: "error", error: e2 });
            throw e2;
          }
        }
      }
      this.emit({ type: "error", error: e });
      throw e;
    }
  }

  private url(path: string, query?: RequestOptions["query"]): string {
    let url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    return url;
  }

  /** Appel HTTP brut : aucune logique de rafraîchissement. */
  private async raw<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
    if (opts.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (opts.auth !== false && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;

    let res: Response;
    try {
      res = await this.fetchImpl(this.url(path, opts.query), {
        method,
        headers,
        body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") throw e;
      throw ApiError.network(e);
    }

    const text = res.status === 204 ? "" : await res.text();
    let data: unknown = undefined;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) throw ApiError.fromResponse(res.status, data);
    return data as T;
  }
}
