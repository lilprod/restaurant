import { ApiClient, ApiError, memoryTokenStorage, type ClientEvent } from "@restaurant/api-client";
import { describe, expect, it, vi } from "vitest";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Faux serveur : jetons d'accès valides suivis, refresh token à rotation (comme l'API). */
function fakeServer(opts: { refreshFails?: boolean; refreshDelayMs?: number; refreshBody?: unknown; refreshStatus?: number } = {}) {
  let validAccess = "access-1";
  let validRefresh = "refresh-1";
  let n = 1;
  const calls: string[] = [];
  const handler: Handler = async (url, init) => {
    const path = url.replace("/api/v1", "");
    calls.push(`${init.method} ${path}`);
    if (path.endsWith("/auth/refresh")) {
      if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
      const body = JSON.parse(String(init.body)) as { refreshToken: string };
      if (opts.refreshFails || body.refreshToken !== validRefresh) {
        return json(opts.refreshStatus ?? 401, opts.refreshBody ?? { statusCode: 401, message: "Session expirée" });
      }
      n += 1;
      validAccess = `access-${n}`;
      validRefresh = `refresh-${n}`;
      return json(200, { accessToken: validAccess, refreshToken: validRefresh, expiresIn: 900 });
    }
    if (path.endsWith("/auth/logout")) return json(204, undefined);
    const auth = (init.headers as Record<string, string>).Authorization;
    if (auth !== `Bearer ${validAccess}`) return json(401, { statusCode: 401, message: "Jeton invalide ou expiré" });
    return json(200, { ok: true, path });
  };
  return {
    calls,
    fetch: vi.fn((url: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(url), init ?? {}))) as unknown as typeof fetch,
    expireAccess: () => { validAccess = "expired-on-server"; },
    rotateElsewhere: () => { n += 1; validRefresh = `refresh-${n}`; return validRefresh; },
  };
}

function setup(server: ReturnType<typeof fakeServer>, refresh: string | null = "refresh-1") {
  const storage = memoryTokenStorage(refresh);
  const client = new ApiClient({ baseUrl: "/api/v1", space: "tenant", storage, fetch: server.fetch });
  const events: ClientEvent[] = [];
  client.subscribe((e) => events.push(e));
  return { client, storage, events };
}

describe("ApiClient — rafraîchissement des jetons", () => {
  it("rafraîchit d'abord quand seul le refresh token est connu (page rechargée)", async () => {
    const server = fakeServer();
    const { client, storage } = setup(server);
    await expect(client.get("/tenant/settings")).resolves.toMatchObject({ ok: true });
    expect(server.calls).toEqual(["POST /tenant/auth/refresh", "GET /tenant/settings"]);
    expect(storage.get()).toBe("refresh-2");
    expect(client.getAccessToken()).toBe("access-2");
  });

  it("sur 401, fait tourner le refresh token puis rejoue la requête", async () => {
    const server = fakeServer();
    const { client } = setup(server, null);
    client.setSession({ accessToken: "access-1", refreshToken: "refresh-1" });
    server.expireAccess();
    await expect(client.get("/tenant/license")).resolves.toMatchObject({ path: "/tenant/license" });
    expect(server.calls).toEqual(["GET /tenant/license", "POST /tenant/auth/refresh", "GET /tenant/license"]);
  });

  it("un seul rafraîchissement en vol pour des 401 simultanés", async () => {
    const server = fakeServer({ refreshDelayMs: 20 });
    const { client } = setup(server, null);
    client.setSession({ accessToken: "access-1", refreshToken: "refresh-1" });
    server.expireAccess();
    const results = await Promise.all([client.get("/a"), client.get("/b"), client.get("/c"), client.get("/d")]);
    expect(results).toHaveLength(4);
    expect(server.calls.filter((c) => c.endsWith("/auth/refresh"))).toHaveLength(1);
  });

  it("termine la session si le rafraîchissement échoue", async () => {
    const server = fakeServer({ refreshFails: true });
    const { client, storage, events } = setup(server, null);
    client.setSession({ accessToken: "access-1", refreshToken: "refresh-1" });
    server.expireAccess();
    const err = await client.get("/tenant/settings").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(storage.get()).toBeNull();
    expect(client.getAccessToken()).toBeNull();
    expect(events.some((e) => e.type === "session-ended")).toBe(true);
  });

  it("signale LICENSE_BLOCKED au rafraîchissement (licence expirée)", async () => {
    const server = fakeServer({ refreshFails: true, refreshStatus: 403, refreshBody: { statusCode: 403, code: "LICENSE_BLOCKED", message: "La licence de ce restaurant a expiré." } });
    const { client, events } = setup(server);
    await client.get("/tenant/settings").catch(() => undefined);
    const ended = events.find((e) => e.type === "session-ended");
    expect(ended && ended.type === "session-ended" && ended.reason?.code).toBe("LICENSE_BLOCKED");
    expect(events.some((e) => e.type === "error" && e.error.isLicenseBlocked)).toBe(true);
  });

  it("reprend le jeton déjà tourné par un autre onglet au lieu de déconnecter", async () => {
    const server = fakeServer();
    const { client, storage } = setup(server, null);
    client.setSession({ accessToken: "access-1", refreshToken: "refresh-1" });
    server.expireAccess();
    // Un autre onglet a fait tourner le jeton entre-temps et l'a écrit dans le stockage partagé.
    const original = server.fetch;
    let swapped = false;
    const wrapped = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!swapped && String(url).endsWith("/auth/refresh")) { swapped = true; storage.set(server.rotateElsewhere()); }
      return original(url, init);
    }) as unknown as typeof fetch;
    (client as unknown as { fetchImpl: typeof fetch }).fetchImpl = wrapped;
    await expect(client.get("/x")).resolves.toMatchObject({ ok: true });
    expect(storage.get()).toMatch(/^refresh-/);
  });

  it("n'essaie pas de rafraîchir les routes publiques", async () => {
    const server = fakeServer();
    const { client } = setup(server, null);
    const err = await client.post("/tenant/auth/login", { email: "x" }, { auth: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(server.calls).toEqual(["POST /tenant/auth/login"]);
  });
});

describe("ApiError", () => {
  it("expose code, erreurs de champ et restriction", () => {
    const e = ApiError.fromResponse(400, { message: "Données invalides", errors: [{ path: "admin.password", message: "Au moins 10 caractères" }] });
    expect(e.status).toBe(400);
    expect(e.errors).toEqual([{ path: "admin.password", message: "Au moins 10 caractères" }]);
    const r = ApiError.fromResponse(403, { statusCode: 403, code: "RESTRICTED_SESSION", restriction: "2fa-setup", message: "La double authentification est obligatoire pour votre rôle." });
    expect(r.isRestricted).toBe(true);
    expect(r.restriction).toBe("2fa-setup");
  });

  it("lit les minutes restantes d'un compte verrouillé (423)", () => {
    const e = ApiError.fromResponse(423, { statusCode: 423, code: "ACCOUNT_LOCKED", message: "Trop de tentatives. Réessayez dans 14 minute(s)." });
    expect(e.isLocked).toBe(true);
    expect(e.lockedMinutes).toBe(14);
  });

  it("traduit le message du limiteur de débit", () => {
    expect(ApiError.fromResponse(429, { statusCode: 429, message: "ThrottlerException: Too Many Requests" }).message).toMatch(/Trop de tentatives/);
  });
});

describe("ApiClient — envoi de fichier", () => {
  it("envoie un multipart sans forcer le Content-Type", async () => {
    const seen: RequestInit[] = [];
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => { seen.push(init!); return json(201, { kind: "logo", url: "/uploads/x.png" }); }) as unknown as typeof fetch;
    const client = new ApiClient({ baseUrl: "/api/v1", space: "platform", storage: memoryTokenStorage(), fetch: f });
    client.setSession({ accessToken: "a", refreshToken: "r" });
    await client.upload("/platform/settings/assets/logo", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { filename: "logo.png" });
    const init = seen[0]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer a");
  });
});
