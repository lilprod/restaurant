import { afterEach, describe, expect, it, vi } from "vitest";
import { disablePush, isIos, readPushState, syncPush, urlBase64ToBytes } from "../push";

const config = async (enabled = true) => ({ enabled, publicKey: enabled ? "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" : null });

afterEach(() => vi.unstubAllGlobals());

describe("urlBase64ToBytes", () => {
  it("décode la clé publique VAPID (65 octets, préfixe 0x04)", () => {
    const b = urlBase64ToBytes("BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U");
    expect(b.length).toBe(65);
    expect(b[0]).toBe(4);
  });
});

describe("état de l'appareil", () => {
  it("navigateur sans push : indisponible", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/126", maxTouchPoints: 0, platform: "Linux" });
    expect(await readPushState({ config })).toBe("unsupported");
  });

  it("iPhone sans l'application installée : marche à suivre « écran d'accueil »", async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", maxTouchPoints: 5, platform: "iPhone" });
    expect(isIos()).toBe(true);
    expect(await readPushState({ config })).toBe("ios-install");
  });

  it("iPhone avec l'application installée mais sans push : indisponible (pas la marche à suivre)", async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)", maxTouchPoints: 5, platform: "iPhone" });
    expect(await readPushState({ config })).toBe("unsupported");
  });
});

describe("désactivation et resynchronisation sans push", () => {
  it("ne lèvent jamais d'exception quand le navigateur n'a ni service worker ni abonnement", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { userAgent: "x", maxTouchPoints: 0, platform: "Linux" });
    const api = { unsubscribe: vi.fn(), config, subscribe: vi.fn() };
    await expect(disablePush(api)).resolves.toBeUndefined();
    await expect(syncPush(api)).resolves.toBeUndefined();
    expect(api.unsubscribe).not.toHaveBeenCalled();
    expect(api.subscribe).not.toHaveBeenCalled();
  });
});
