import { Prisma } from "@prisma/client";
import {
  canConvert, compatibleUnits, convertQty, dishMargin, purchaseLineTotal, recipeCost, stockState, stockValue, unitFactor, weightedAvgCost,
} from "@restaurant/utils";
import { toStockUnit } from "./stock.service";

describe("stock : unités et conversions", () => {
  it("convertit dans une même dimension et refuse le reste", () => {
    expect(convertQty(250, "g", "kg")).toBe(0.25);
    expect(convertQty(1.5, "l", "cl")).toBe(150);
    expect(convertQty(33, "cl", "ml")).toBe(330);
    expect(unitFactor("kg", "g")).toBe(1000);
    expect(canConvert("g", "l")).toBe(false);
    expect(canConvert("piece", "piece")).toBe(true);
    expect(() => unitFactor("g", "piece")).toThrow(/incompatibles/);
    expect(compatibleUnits("kg")).toEqual(["g", "kg"]);
    expect(compatibleUnits("cl")).toEqual(["ml", "cl", "l"]);
  });

  it("convertit en Decimal sans perte pour l'API", () => {
    expect(toStockUnit(new Prisma.Decimal("150"), "g", "kg").toString()).toBe("0.15");
    expect(toStockUnit(2, null, "piece").toString()).toBe("2");
    expect(toStockUnit(new Prisma.Decimal("0.5"), "g", "kg").mul(3).toDecimalPlaces(3).toString()).toBe("0.002");
  });
});

describe("stock : états, valeur, coûts", () => {
  it("classe l'état d'un ingrédient (négatif signalé, seuil inclus)", () => {
    expect(stockState(-0.5, 2)).toBe("NEGATIVE");
    expect(stockState(0, 0)).toBe("OUT");
    expect(stockState(2, 2)).toBe("LOW");
    expect(stockState(2.001, 2)).toBe("OK");
    expect(stockValue(-3, 500)).toBe(0);
    expect(stockValue(1.25, 600)).toBe(750);
  });

  it("calcule le coût matière (arrondi une fois) et la marge sur le prix hors TVA", () => {
    const cost = recipeCost([
      { quantity: 150, unit: "g", ingredient: { unit: "kg", avgCost: 1200 } }, // 180
      { quantity: 1, ingredient: { unit: "piece", avgCost: 75 } },             // 75
      { quantity: 0.333, unit: null, ingredient: { unit: "l", avgCost: 1000 } }, // 333
    ]);
    expect(cost).toBe(588);
    // 3 500 TTC à 10 % : TVA 318 → HT 3 182 ; marge 2 594
    expect(dishMargin(3500, 10, cost)).toEqual({ net: 3182, cost: 588, margin: 2594, marginRate: 81.5 });
    expect(dishMargin(0, 10, 0).marginRate).toBeNull();
  });

  it("met à jour le coût moyen pondéré à la réception (stock négatif compté pour zéro)", () => {
    expect(weightedAvgCost(10, 1000, 10, 1200)).toBe(1100);
    expect(weightedAvgCost(0, 0, 5, 800)).toBe(800);
    expect(weightedAvgCost(-4, 1000, 6, 900)).toBe(900);
    expect(weightedAvgCost(3, 1000, 0, 5000)).toBe(1000);
    expect(purchaseLineTotal(2.5, 1500)).toBe(3750);
  });
});
