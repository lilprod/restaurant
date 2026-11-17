import { describe, expect, it } from "vitest";
import { kitchenInputFromCart } from "@/features/tenant/pos/offline-ticket";
import { printEscpos, serialTransport, usbTransport, type SerialPortLike, type UsbDeviceLike } from "../drivers";
import { encodeEscpos, encodeText, wrap } from "../escpos";
import { kitchenInputFromOrder, kitchenTicketDoc, receiptTicketDoc, testTicketDoc } from "../ticket-doc";

const text = (b: Uint8Array) => [...b].map((c) => (c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : c === 10 ? "\n" : "·")).join("");

describe("ESC/POS", () => {
  it("initialise, choisit CP858, coupe le papier", () => {
    const b = encodeEscpos(testTicketDoc("x"));
    expect([...b.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect([...b.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0]);
  });
  it("encode les accents français en CP858", () => {
    expect(encodeText("é è à ç ô É À €")).toEqual([0x82, 0x20, 0x8a, 0x20, 0x85, 0x20, 0x87, 0x20, 0x93, 0x20, 0x90, 0x20, 0xb7, 0x20, 0xd5]);
    expect(encodeText("œ×")).toEqual([...Buffer.from("oex")]);
    expect(encodeText("日")).toEqual([0x3f]);
  });
  it("aligne les paires sur la largeur du papier et gonfle la taille", () => {
    const b = encodeEscpos({ kind: "test", lines: [{ t: "pair", left: "Poulet", right: "9 500" }] }, { columns: 32, cut: false });
    expect(text(b)).toContain(`Poulet${" ".repeat(32 - 6 - 5)}9 500`);
    const big = encodeEscpos({ kind: "test", lines: [{ t: "text", text: "A".repeat(30), size: 2 }] }, { columns: 32, cut: false });
    expect([...big].join(",")).toContain("29,33,17");             // GS ! 0x11 (double largeur et hauteur)
    expect(text(big).split("\n").filter((l) => /A{16}/.test(l))).toHaveLength(1);   // 16 caractères par ligne en double largeur
  });
  it("coupe les mots trop longs", () => { expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]); });
});

describe("tickets", () => {
  const order = {
    number: 12, type: "DINE_IN", table: { label: "T3" }, customerName: null, notes: "Allergie arachide", waiter: { firstName: "Ama" }, createdAt: "2026-11-17T10:00:00Z",
    items: [
      { id: "i1", menuItemId: "m1", parentItemId: null, stepName: null, name: "Poulet braisé", quantity: 2, status: "PENDING", instructions: "Bien pimenté", course: 1, options: [{ name: "Alloco" }], createdAt: "" },
      { id: "i2", menuItemId: "m2", parentItemId: null, stepName: null, name: "Bissap", quantity: 3, status: "PENDING", instructions: null, course: 1, options: [], createdAt: "" },
      { id: "i3", menuItemId: "m1", parentItemId: null, stepName: null, name: "Annulé", quantity: 1, status: "CANCELLED", instructions: null, course: 1, options: [], createdAt: "" },
    ],
  };
  const stationOf = (id: string | null) => (id === "m1" ? "Plats" : "Boissons");

  it("ticket cuisine : gros caractères, regroupé par poste, consignes en gras, sans article annulé", () => {
    const doc = kitchenTicketDoc(kitchenInputFromOrder(order, stationOf));
    const t = doc.lines.filter((l) => l.t === "text").map((l) => (l as { text: string }).text);
    expect(t).toContain("N° 12"); expect(t).toContain("Table T3");
    expect(t.indexOf("PLATS")).toBeLessThan(t.indexOf("2 x Poulet braisé"));
    expect(t.indexOf("BOISSONS")).toBeLessThan(t.indexOf("3 x Bissap"));
    expect(t).toContain("   + Alloco"); expect(t).toContain("   !! Bien pimenté"); expect(t).toContain("Note : Allergie arachide");
    expect(t.join("|")).not.toContain("Annulé");
    expect(doc.lines.find((l) => l.t === "text" && l.text.startsWith("2 x"))).toMatchObject({ size: 2, bold: true });
  });
  it("ajout d'articles : seuls les nouveaux articles ; réimpression signalée", () => {
    const add = kitchenTicketDoc(kitchenInputFromOrder(order, stationOf, { onlyItemIds: new Set(["i2"]) }));
    const t = add.lines.filter((l) => l.t === "text").map((l) => (l as { text: string }).text).join("|");
    expect(t).toContain("CUISINE · AJOUT"); expect(t).toContain("Bissap"); expect(t).not.toContain("Poulet");
    expect(JSON.stringify(kitchenTicketDoc(kitchenInputFromOrder(order, stationOf, { reprint: true })))).toContain("RÉIMPRESSION");
  });
  it("commande saisie hors ligne : référence locale à la place du numéro, formule par poste", () => {
    const k = kitchenInputFromCart([
      { key: "a", menuItemId: "m1", name: "Poulet", unitPrice: 3500, vatRate: 18, options: [{ id: "o", name: "Riz", extra: 0 }], quantity: 1, instructions: "", course: 1 },
      { key: "b", menuItemId: null, formulaId: "f1", name: "Menu midi", unitPrice: 5000, vatRate: 18, options: [], quantity: 2, instructions: "", course: 1, choices: [{ stepId: "s", stepName: "Entrée", menuItemId: "m2", name: "Salade" }] },
    ], { type: "DINE_IN", tableLabel: "T1", localRef: "L-AB12", stationOf });
    const doc = kitchenTicketDoc(k);
    const t = doc.lines.filter((l) => l.t === "text").map((l) => (l as { text: string }).text);
    expect(t).toContain("HORS LIGNE"); expect(t).toContain("L-AB12");
    expect(t).toContain("2 x Entrée : Salade"); expect(t).toContain("   (Menu midi)");
  });
  it("ticket caisse : montants repris tels quels de l'API (aucun recalcul)", () => {
    const r = {
      restaurant: { name: "Chez Kofi", legalName: null, address: "Lomé", phone: null, email: null, taxId: null, registrationNumber: null, logoUrl: null, headerText: null, footerText: null },
      currency: "XOF", printedAt: "2026-11-17T10:30:00Z", vatBreakdown: [{ rate: 18, base: 8051, vat: 1449 }],
      order: { ...order, id: "o", type: "DINE_IN", subtotal: 9500, serviceCharge: 0, deliveryFee: 0, discountTotal: 0, total: 9500, remaining: 0, delivery: null,
        items: [{ ...order.items[0], unitPrice: 3500, optionsExtra: 500, lineTotal: 8000, discount: 0, promotionName: null, options: [{ optionId: "x", name: "Alloco", extra: 500 }] }, { ...order.items[1], unitPrice: 500, optionsExtra: 0, lineTotal: 1500, discount: 0, promotionName: null, options: [] }],
        payments: [{ id: "p", method: "CASH", status: "PAID", amount: 9500, tip: 0, tendered: 10000, change: 500, reference: null }] },
    } as never;
    const doc = receiptTicketDoc(r, { trackingUrl: "https://x/suivi/abc" });
    const pairs = doc.lines.filter((l) => l.t === "pair").map((l) => `${(l as { left: string }).left}=${(l as { right: string }).right}`);
    expect(pairs).toContain("TOTAL TTC=9 500 FCFA");
    expect(pairs).toContain("2 x Poulet braisé=8 000"); expect(pairs).toContain("  Rendu=500");
    expect(pairs.some((p) => p.startsWith("TVA 18 %") && p.endsWith("=1 449"))).toBe(true);
    expect(doc.lines.some((l) => l.t === "qr")).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/[  ]/);
  });
});

describe("pilotes ESC/POS avec faux port", () => {
  it("Web Serial : ouvre le port, écrit les octets du ticket, referme", async () => {
    const written: number[] = []; const log: string[] = [];
    const port: SerialPortLike = {
      open: async (o) => { log.push(`open:${o.baudRate}`); }, close: async () => { log.push("close"); },
      writable: { getWriter: () => ({ write: async (d) => { written.push(...d); }, releaseLock: () => { log.push("release"); } }) },
    };
    await printEscpos(testTicketDoc("t"), { columns: 48, copies: 2 }, serialTransport(port, 19200));
    const one = [...encodeEscpos(testTicketDoc("t"), { columns: 48 })];
    expect(written).toEqual([...one, ...one]);
    expect(log[0]).toBe("open:19200"); expect(log.at(-1)).toBe("close");
  });
  it("WebUSB : trouve la sortie bulk de la classe imprimante et envoie les octets", async () => {
    const sent: number[] = [];
    const dev: UsbDeviceLike = {
      opened: false, vendorId: 1, productId: 2,
      configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 7, endpoints: [{ endpointNumber: 1, direction: "in", type: "bulk" }, { endpointNumber: 2, direction: "out", type: "bulk" }] }] }] },
      open: async function () { this.opened = true; }, close: async function () { this.opened = false; }, selectConfiguration: async () => undefined, claimInterface: async () => undefined,
      transferOut: async (ep, d) => { expect(ep).toBe(2); sent.push(...new Uint8Array(d as ArrayBuffer)); return {}; },
    };
    await printEscpos(testTicketDoc("t"), { columns: 48, copies: 1 }, usbTransport(dev));
    expect(sent).toEqual([...encodeEscpos(testTicketDoc("t"), { columns: 48 })]);
  });
});
