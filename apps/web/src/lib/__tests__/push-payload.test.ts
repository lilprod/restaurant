import { describe, expect, it } from "vitest";
import { FALLBACK_PUSH, parsePushPayload, restaurantPrefix, safeNotificationUrl } from "../push-payload";

const ORIGIN = "https://app.exemple.com";

describe("safeNotificationUrl", () => {
  it("garde un chemin interne (avec requête et ancre)", () => {
    expect(safeNotificationUrl("/r/chez-kofi/cuisine", ORIGIN)).toBe("/r/chez-kofi/cuisine");
    expect(safeNotificationUrl("/r/x/commandes/42?a=1#b", ORIGIN)).toBe("/r/x/commandes/42?a=1#b");
    expect(safeNotificationUrl("https://app.exemple.com/r/x/cuisine", ORIGIN)).toBe("/r/x/cuisine");
  });
  it.each([
    "https://evil.example.org/r/x", "//evil.example.org/x", "http://app.exemple.com/x", "javascript:alert(1)", "data:text/html,<b>x</b>",
    "https://app.exemple.com.evil.org/x", "\\\\evil.example.org", "", null, 42, "x".repeat(600),
  ])("refuse %j (retour à l'accueil)", (raw) => expect(safeNotificationUrl(raw, ORIGIN)).toBe("/"));
});

describe("parsePushPayload", () => {
  it("lit une charge valide et borne les longueurs", () => {
    const p = parsePushPayload(JSON.stringify({ title: "Nouvelle livraison", body: "Commande n°4", url: "/r/x/mes-livraisons", tag: "delivery:1", renotify: true, extra: "ignoré" }), ORIGIN);
    expect(p).toEqual({ title: "Nouvelle livraison", body: "Commande n°4", url: "/r/x/mes-livraisons", tag: "delivery:1" });
    expect(parsePushPayload(JSON.stringify({ title: "T".repeat(500), body: "B".repeat(500) }), ORIGIN)).toMatchObject({ title: "T".repeat(80), body: "B".repeat(240), tag: FALLBACK_PUSH.tag });
  });
  it("une adresse externe devient l'accueil", () => {
    expect(parsePushPayload(JSON.stringify({ title: "X", url: "https://evil.example.org/phish" }), ORIGIN).url).toBe("/");
  });
  it.each([null, undefined, "", "pas du json", "[]", "42", '"texte"', "{}", JSON.stringify({ title: 3 }), JSON.stringify({ title: "  " })])("charge illisible %j → alerte générique (toujours affichable)", (raw) => {
    expect(parsePushPayload(raw as string | null, ORIGIN)).toEqual(FALLBACK_PUSH);
  });
});

describe("restaurantPrefix", () => {
  it("extrait /r/<slug>", () => {
    expect(restaurantPrefix("/r/chez-kofi/cuisine")).toBe("/r/chez-kofi");
    expect(restaurantPrefix("/r/chez-kofi")).toBe("/r/chez-kofi");
    expect(restaurantPrefix("/admin")).toBeNull();
    expect(restaurantPrefix("/")).toBeNull();
  });
});
