import { describe, expect, it } from "vitest";
import { orderLines } from "@/lib/order-lines";
import { payableItems } from "../checkout/payment-math";
import { cartDiscount, cartReducer, cartTotals, checkFormula, toOrderItems, togglePick, type CartLine } from "../pos/cart";
import { bissap, item, order, poulet } from "./fixtures";

const formula = { id: "f1", name: "Menu du jour", price: 6000 };
const steps = [
  { id: "s1", name: "Entrée", minChoices: 1, maxChoices: 1, items: [{ menuItemId: "a", name: "Salade", price: 1500, isAvailable: true }, { menuItemId: "b", name: "Soupe", price: 1500, isAvailable: true }] },
  { id: "s2", name: "Dessert", minChoices: 0, maxChoices: 2, items: [{ menuItemId: "d", name: "Gâteau", price: 1000, isAvailable: true }] },
];

describe("panier : formules et promotions", () => {
  const choices = [{ stepId: "s1", stepName: "Entrée", menuItemId: "a", name: "Salade" }];

  it("ajoute une formule au prix fixe et la cumule à l'identique", () => {
    let lines: CartLine[] = cartReducer([], { type: "addFormula", formula, vatRate: 18, choices });
    lines = cartReducer(lines, { type: "addFormula", formula, vatRate: 18, choices });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ formulaId: "f1", menuItemId: null, quantity: 2 });
    expect(cartTotals(lines, { serviceChargePercent: 0, defaultVatRate: 18 }).total).toBe(12000);
    // Un autre choix est une autre ligne.
    lines = cartReducer(lines, { type: "addFormula", formula, vatRate: 18, choices: [{ ...choices[0]!, menuItemId: "b", name: "Soupe" }] });
    expect(lines).toHaveLength(2);
  });

  it("envoie formulaId + choix à l'API, menuItemId pour un plat", () => {
    const lines = cartReducer(cartReducer([], { type: "addFormula", formula, vatRate: 18, choices }), { type: "add", item: bissap });
    const [f, d] = toOrderItems(lines);
    expect(f).toMatchObject({ formulaId: "f1", choices: [{ stepId: "s1", menuItemId: "a" }] });
    expect(f!.menuItemId).toBeUndefined();
    expect(d).toMatchObject({ menuItemId: bissap.id });
  });

  it("prix remisé et total des remises", () => {
    const lines = cartReducer([], { type: "add", item: poulet, optionIds: [], quantity: 2, promo: { unitPrice: 3000, name: "Happy hour" } });
    expect(lines[0]).toMatchObject({ unitPrice: 3000, discountPerUnit: 1000, promotionName: "Happy hour" });
    expect(cartTotals(lines, { serviceChargePercent: 0, defaultVatRate: 18 }).subtotal).toBe(6000);
    expect(cartDiscount(lines)).toBe(2000);
  });

  it("valide les étapes (min / max) et bascule les choix", () => {
    expect(checkFormula(steps, {}).map((c) => c.ok)).toEqual([false, true]);
    let picks = togglePick(steps[0]!, {}, "a");
    picks = togglePick(steps[0]!, picks, "b");
    expect(picks.s1).toEqual(["b"]); // choix unique : remplace
    picks = togglePick(steps[1]!, picks, "d");
    expect(checkFormula(steps, picks).every((c) => c.ok)).toBe(true);
  });
});

describe("commande : lignes de formule", () => {
  const parent = item({ id: "p", menuItemId: null, formulaId: "f1", name: "Menu du jour", unitPrice: 6000, lineTotal: 6000 });
  const kid = (id: string) => item({ id, parentItemId: "p", name: id, unitPrice: 0, lineTotal: 0 });

  it("range les plats sous leur formule", () => {
    const solo = item({ id: "s" });
    expect(orderLines([kid("k1"), parent, solo, kid("k2")]).map((i) => i.id)).toEqual(["p", "k1", "k2", "s"]);
  });

  it("ne propose à l'encaissement par article que la formule, pas ses plats", () => {
    const o = order({ items: [parent, kid("k1"), kid("k2")] });
    expect(payableItems(o).map((i) => i.id)).toEqual(["p"]);
  });
});
