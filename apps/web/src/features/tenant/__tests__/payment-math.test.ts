import { describe, expect, it } from "vitest";
import { orderPaymentSchema } from "@restaurant/validation";
import { changeDue, equalParts, payableItems, quickTenders, splitByItems, tipFromPercent } from "../checkout/payment-math";
import { item, order } from "./fixtures";

describe("partage égal", () => {
  it("redivise le reste entre ceux qui n'ont pas payé, sans perdre de franc", () => {
    expect(equalParts(10_000, 3, 0)).toEqual([3334, 3333, 3333]);
    // Après la première part (3 334), le reste 6 666 se partage entre 2.
    expect(equalParts(6666, 3, 1)).toEqual([3333, 3333]);
    expect(equalParts(3333, 3, 2)).toEqual([3333]);
    expect(equalParts(0, 3, 3)).toEqual([]);
  });
});

describe("partage par article", () => {
  const A = "b0000000-0000-4000-8000-00000000000a", B = "b0000000-0000-4000-8000-00000000000b";
  const a = item({ id: A, unitPrice: 4000, optionsExtra: 500, quantity: 2, lineTotal: 9000 });
  const b = item({ id: B, name: "Bissap", unitPrice: 700, quantity: 3, lineTotal: 2100, paidQuantity: 1 });
  const c = item({ id: "c", status: "CANCELLED", lineTotal: 4000 });
  const o = order({ items: [a, b, c], subtotal: 11_100, serviceCharge: 1110, total: 12_210, paidAmount: 770, remaining: 11_440 });

  it("ignore les articles annulés ou déjà réglés", () => {
    expect(payableItems(o).map((i) => [i.id, i.left])).toEqual([[A, 2], [B, 2]]);
  });

  it("montant = articles choisis + part proportionnelle du service ; allocations pour l'API", () => {
    const s = splitByItems(o, { [A]: 1, [B]: 1 });
    expect(s.itemsAmount).toBe(4500 + 700);
    expect(s.serviceShare).toBe(520);
    expect(s.amount).toBe(5720);
    expect(s.allocations).toEqual([{ orderItemId: A, quantity: 1 }, { orderItemId: B, quantity: 1 }]);
    expect(orderPaymentSchema.safeParse({ method: "CARD", amount: s.amount, allocations: s.allocations }).success).toBe(true);
  });

  it("tout sélectionner = exactement le reste à payer", () => {
    expect(splitByItems(o, { [A]: 2, [B]: 5 }).amount).toBe(11_440);   // quantité plafonnée au restant
    expect(splitByItems(o, {}).amount).toBe(0);
  });
});

describe("espèces : somme remise et monnaie", () => {
  it("propose l'exact puis les arrondis supérieurs usuels", () => {
    expect(quickTenders(3500)).toEqual([3500, 4000, 5000, 10000]);
    expect(quickTenders(7200)).toEqual([7200, 7500, 8000, 10000]);
    expect(quickTenders(10_000)).toEqual([10_000]);
    expect(quickTenders(0)).toEqual([]);
  });

  it("calcule la monnaie à rendre (négatif = il manque)", () => {
    expect(changeDue(10_000, 7200, 500)).toBe(2300);
    expect(changeDue(5000, 7200, 0)).toBe(-2200);
  });

  it("le schéma partagé refuse une somme remise insuffisante et exige la référence Flooz", () => {
    expect(orderPaymentSchema.safeParse({ method: "CASH", amount: 7200, tip: 500, tendered: 7500 }).success).toBe(false);
    expect(orderPaymentSchema.safeParse({ method: "FLOOZ", amount: 7200 }).success).toBe(false);
    expect(orderPaymentSchema.safeParse({ method: "FLOOZ", amount: 7200, reference: "FL-1" }).success).toBe(true);
  });

  it("pourboire en pourcentage arrondi à 50 FCFA", () => {
    expect(tipFromPercent(7200, 10)).toBe(700);
    expect(tipFromPercent(12_345, 5)).toBe(600);
  });
});
