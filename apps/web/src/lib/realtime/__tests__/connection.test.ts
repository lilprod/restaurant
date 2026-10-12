import { describe, expect, it, vi } from "vitest";
import { authRetryDelay, RealtimeConnection, realtimeOrigin, type RealtimeStatus } from "../connection";

/** Fausse socket Socket.io : enregistre les écouteurs et permet de déclencher les événements. */
function fakeSocket() {
  const handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  const any: ((e: string, p: unknown) => void)[] = [];
  let opts: { auth: (cb: (d: { token: string }) => void) => void } | null = null;
  const s = {
    connected: false,
    connects: 0,
    on(e: string, fn: (...a: unknown[]) => void) { handlers.set(e, [...(handlers.get(e) ?? []), fn]); return s; },
    onAny(fn: (e: string, p: unknown) => void) { any.push(fn); return s; },
    offAny() { any.length = 0; return s; },
    removeAllListeners() { handlers.clear(); return s; },
    connect() { s.connects += 1; return s; },
    disconnect() { s.connected = false; return s; },
    emit(e: string, ...a: unknown[]) { for (const fn of handlers.get(e) ?? []) fn(...a); for (const fn of any) fn(e, a[0]); },
    token() { let t = ""; opts!.auth((d) => { t = d.token; }); return t; },
  };
  const factory = ((_url: string, o: typeof opts) => { opts = o; return s; }) as never;
  return { s, factory };
}

describe("connexion temps réel", () => {
  it("calcule l'origine et le délai de nouvelle tentative", () => {
    expect(realtimeOrigin("/api/v1", { origin: "http://localhost:5173" })).toBe("http://localhost:5173");
    expect(realtimeOrigin("https://api.exemple.com/api/v1")).toBe("https://api.exemple.com");
    expect([1, 2, 3, 10].map(authRetryDelay)).toEqual([1000, 2000, 4000, 30_000]);
  });

  it("refus d'authentification : rafraîchit le jeton puis se reconnecte avec le nouveau, et resynchronise", async () => {
    vi.useFakeTimers();
    const { s, factory } = fakeSocket();
    let token = "ancien";
    const client = { getAccessToken: () => token, hasRefreshToken: () => true, refresh: vi.fn(async () => { token = "nouveau"; return true; }) };
    const statuses: RealtimeStatus[] = [];
    const onResync = vi.fn();
    const onOrder = vi.fn();
    const conn = new RealtimeConnection({ origin: "http://x", client, connect: factory, handlers: { onStatus: (v) => statuses.push(v), onOrder, onResync } });
    await conn.start();
    expect(s.connects).toBe(1);
    expect(s.token()).toBe("ancien");
    s.emit("ready", {});
    expect(conn.getStatus()).toBe("connected");

    s.emit("order.created", { id: "o1" });
    expect(onOrder).toHaveBeenCalledWith("order.created", { id: "o1" });

    // Jeton expiré à la reconnexion : le serveur répond auth_error puis coupe.
    s.emit("auth_error", { message: "Jeton invalide ou expiré" });
    s.emit("disconnect", "io server disconnect");
    expect(conn.getStatus()).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(s.connects).toBe(2);
    expect(s.token()).toBe("nouveau");
    s.emit("ready", {});
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(["connecting", "connected", "reconnecting", "connected"]);

    conn.stop();
    expect(conn.getStatus()).toBe("idle");
    vi.useRealTimers();
  });

  it("session terminée (rafraîchissement refusé) : arrête la connexion", async () => {
    vi.useFakeTimers();
    const { s, factory } = fakeSocket();
    let hasRefresh = true;
    const client = { getAccessToken: () => "x", hasRefreshToken: () => hasRefresh, refresh: vi.fn(async () => { hasRefresh = false; return false; }) };
    const conn = new RealtimeConnection({ origin: "http://x", client, connect: factory, handlers: { onStatus: () => undefined, onOrder: () => undefined, onResync: () => undefined } });
    await conn.start();
    s.emit("auth_error", {});
    s.emit("disconnect", "io server disconnect");
    await vi.advanceTimersByTimeAsync(1000);
    expect(conn.getStatus()).toBe("idle");
    expect(s.connects).toBe(1);
    vi.useRealTimers();
  });
});
