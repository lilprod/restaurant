import { describe, expect, it } from "vitest";
import { createOrderSchema } from "@restaurant/validation";
import {
  cartCount, cartReducer, cartTotals, checkSelection, defaultSelection, groupRuleLabel, lineSignature, selectionExtra, toggleOption, toOrderItems,
  type CartLine,
} from "../pos/cart";
import { bissap, O, poulet } from "./fixtures";

const ops = { serviceChargePercent: 0, defaultVatRate: 18 };

describe("panier de prise de commande", () => {
  it("cumule deux ajouts identiques et sépare les variantes", () => {
    let lines: CartLine[] = [];
    lines = cartReducer(lines, { type: "add", item: poulet, optionIds: [O.att] });
    lines = cartReducer(lines, { type: "add", item: poulet, optionIds: [O.att] });
    lines = cartReducer(lines, { type: "add", item: poulet, optionIds: [O.fri] });
    lines = cartReducer(lines, { type: "add", item: poulet, optionIds: [O.att], instructions: "Bien cuit" });
    expect(lines).toHaveLength(3);
    expect(lines[0]!.quantity).toBe(2);
    expect(cartCount(lines)).toBe(4);
  });

  it("l'ordre des options ne change pas la signature d'une ligne", () => {
    expect(lineSignature("x", ["b", "a"])).toBe(lineSignature("x", ["a", "b"]));
  });

  it("modifie la quantité, retire à 0 et plafonne à 99", () => {
    let lines = cartReducer([], { type: "add", item: bissap, quantity: 3 });
    const key = lines[0]!.key;
    lines = cartReducer(lines, { type: "quantity", key, quantity: 150 });
    expect(lines[0]!.quantity).toBe(99);
    lines = cartReducer(lines, { type: "quantity", key, quantity: 0 });
    expect(lines).toEqual([]);
  });

  it("une consigne qui rend deux lignes identiques les fusionne", () => {
    let lines = cartReducer([], { type: "add", item: bissap, instructions: "sans sucre" });
    lines = cartReducer(lines, { type: "add", item: bissap, quantity: 2 });
    lines = cartReducer(lines, { type: "update", key: lines[1]!.key, patch: { instructions: "Sans sucre" } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(3);
  });

  it("totaux en direct : suppléments, service et TVA incluse par taux (calcul partagé avec l'API)", () => {
    let lines = cartReducer([], { type: "add", item: poulet, optionIds: [O.all, O.moy], quantity: 2 });   // (4000+500+200)×2
    lines = cartReducer(lines, { type: "add", item: bissap, quantity: 2 });                                // 1400 à 10 %
    const t = cartTotals(lines, { serviceChargePercent: 10, defaultVatRate: 18 });
    expect(t.subtotal).toBe(9400 + 1400);
    expect(t.serviceCharge).toBe(1080);
    expect(t.total).toBe(11880);
    expect(t.vatBreakdown.map((v) => v.rate)).toEqual([10, 18]);
    expect(t.vatBreakdown[0]!.vat).toBe(Math.round((1400 * 10) / 110));
    expect(cartTotals([], ops).total).toBe(0);
  });

  it("produit un corps valide pour le schéma partagé createOrderSchema", () => {
    let lines = cartReducer([], { type: "add", item: poulet, optionIds: [O.att], instructions: "  bien cuit  ", course: 2 });
    lines = cartReducer(lines, { type: "add", item: bissap });
    const items = toOrderItems(lines);
    expect(items[0]).toEqual({ menuItemId: poulet.id, quantity: 1, optionIds: [O.att], instructions: "bien cuit", course: 2 });
    expect(items[1]!.instructions).toBeUndefined();
    expect(createOrderSchema.safeParse({ type: "TAKEAWAY", customerName: "Awa", items }).success).toBe(true);
    expect(createOrderSchema.safeParse({ type: "DINE_IN", items }).success).toBe(false);
  });
});

describe("options d'un plat (min / max par groupe)", () => {
  it("signale un groupe obligatoire non choisi", () => {
    const c = checkSelection(poulet.optionGroups, []);
    expect(c[0]).toMatchObject({ ok: false, message: "Choisissez une option" });
    expect(c[1]!.ok).toBe(true);
  });

  it("choix unique : remplace l'option précédente du groupe", () => {
    let s = toggleOption(poulet.optionGroups, [], O.att);
    s = toggleOption(poulet.optionGroups, s, O.fri);
    expect(s).toEqual([O.fri]);
    expect(checkSelection(poulet.optionGroups, s).every((c) => c.ok)).toBe(true);
  });

  it("choix multiples : bloque au-delà du maximum et décoche", () => {
    let s = [O.att];
    s = toggleOption(poulet.optionGroups, s, O.pim);
    s = toggleOption(poulet.optionGroups, s, O.moy);
    s = toggleOption(poulet.optionGroups, s, O.ara);   // 3e sauce refusée (max 2)
    expect(s).toEqual([O.att, O.pim, O.moy]);
    expect(checkSelection(poulet.optionGroups, s)[1]!.full).toBe(true);
    expect(toggleOption(poulet.optionGroups, s, O.pim)).toEqual([O.att, O.moy]);
    expect(selectionExtra(poulet.optionGroups, s)).toBe(200);
  });

  it("présélectionne un groupe obligatoire à option unique et décrit les règles", () => {
    const g = [{ id: "g", name: "Pain", minChoices: 1, maxChoices: 1, options: [{ id: "p", name: "Baguette", extra: 0 }] }];
    expect(defaultSelection(g)).toEqual(["p"]);
    expect(groupRuleLabel({ minChoices: 1, maxChoices: 1 })).toBe("Obligatoire");
    expect(groupRuleLabel({ minChoices: 0, maxChoices: 2 })).toBe("Facultatif · 2 max");
    expect(groupRuleLabel({ minChoices: 1, maxChoices: 3 })).toBe("1 à 3 choix");
  });
});
