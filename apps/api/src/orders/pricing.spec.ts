import { canDeliveryTransition, canTransition, computeTotals, deliveryMinimumError, deliveryPhase, deriveOrderStatus, lineTotal, paymentStatusFor, splitEqually, vatIncluded } from "@restaurant/utils";

describe("calculs des commandes", () => {
  it("calcule une ligne avec suppléments", () => {
    expect(lineTotal(3500, 500, 2)).toBe(8000);
  });

  it("extrait la TVA d'un prix TTC", () => {
    expect(vatIncluded(11800, 18)).toBe(1800);
    expect(vatIncluded(1000, 0)).toBe(0);
  });

  it("totalise en ignorant les lignes annulées, avec service et détail de TVA", () => {
    const t = computeTotals({
      items: [
        { lineTotal: 11800, vatRate: 18, status: "SERVED" },
        { lineTotal: 1100, vatRate: 10, status: "PENDING" },
        { lineTotal: 5000, vatRate: 18, status: "CANCELLED" },
      ],
      serviceChargePercent: 10,
      defaultVatRate: 18,
    });
    expect(t.subtotal).toBe(12900);
    expect(t.serviceCharge).toBe(1290);
    expect(t.total).toBe(14190);
    expect(t.vatBreakdown).toEqual([
      { rate: 10, base: 1000, vat: 100 },
      { rate: 18, base: 11093, vat: 1997 },
    ]);
    expect(t.vat).toBe(2097);
  });

  it("partage une addition sans perdre de franc", () => {
    expect(splitEqually(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEqually(9000, 3)).toEqual([3000, 3000, 3000]);
    expect(splitEqually(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(splitEqually(100, 0)).toEqual([]);
  });

  it("déduit le statut de la commande de ses articles", () => {
    expect(deriveOrderStatus(["PENDING", "PENDING"])).toBe("PENDING");
    expect(deriveOrderStatus(["PENDING", "IN_PROGRESS"])).toBe("IN_PROGRESS");
    expect(deriveOrderStatus(["READY", "PENDING"])).toBe("IN_PROGRESS");
    expect(deriveOrderStatus(["READY", "SERVED"])).toBe("READY");
    expect(deriveOrderStatus(["SERVED", "SERVED", "CANCELLED"])).toBe("DELIVERED");
    expect(deriveOrderStatus(["CANCELLED"])).toBe("CANCELLED");
    expect(deriveOrderStatus([])).toBe("PENDING");
  });

  it("calcule l'état de paiement", () => {
    expect(paymentStatusFor(0, 5000)).toBe("UNPAID");
    expect(paymentStatusFor(2000, 5000)).toBe("PARTIAL");
    expect(paymentStatusFor(5000, 5000)).toBe("PAID");
  });

  it("encadre les changements de statut d'un article", () => {
    expect(canTransition("PENDING", "IN_PROGRESS")).toBe(true);
    expect(canTransition("READY", "SERVED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "PENDING")).toBe(true);
    expect(canTransition("SERVED", "PENDING")).toBe(false);
    expect(canTransition("CANCELLED", "PENDING")).toBe(false);
  });
});

describe("livraison (X2)", () => {
  const items = [{ lineTotal: 7000, vatRate: 10, status: "PENDING" as const }, { lineTotal: 1000, vatRate: 18, status: "PENDING" as const }];

  it("ajoute les frais au total, hors service, et leur TVA au taux par défaut", () => {
    const t = computeTotals({ items, serviceChargePercent: 10, defaultVatRate: 18, deliveryFee: 1000 });
    expect(t).toMatchObject({ subtotal: 8000, serviceCharge: 800, deliveryFee: 1000, total: 9800 });
    // 18 % : (1000 + 800 + 1000) TTC → TVA 427 ; 10 % : 7000 TTC → TVA 636
    expect(t.vatBreakdown).toEqual([{ rate: 10, base: 6364, vat: 636 }, { rate: 18, base: 2373, vat: 427 }]);
    expect(t.vat).toBe(1063);
  });

  it("sans frais : comportement inchangé", () => {
    const a = computeTotals({ items, serviceChargePercent: 0, defaultVatRate: 18 });
    expect(a).toMatchObject({ deliveryFee: 0, total: 8000 });
    expect(computeTotals({ items, serviceChargePercent: 0, defaultVatRate: 18, deliveryFee: 0 })).toEqual(a);
  });

  it("des frais seuls portent leur TVA (aucun plat)", () => {
    const t = computeTotals({ items: [], serviceChargePercent: 10, defaultVatRate: 18, deliveryFee: 1180 });
    expect(t).toMatchObject({ subtotal: 0, total: 1180, vat: 180 });
  });

  it("minimum de commande : message en français avec le manque", () => {
    expect(deliveryMinimumError(5000, { name: "Centre", minOrder: 5000 })).toBeNull();
    expect(deliveryMinimumError(0, { name: "Centre", minOrder: 0 })).toBeNull();
    expect(deliveryMinimumError(2000, { name: "Centre", minOrder: 5000 })).toBe("Minimum de commande pour la zone « Centre » : 5 000 FCFA (il manque 3 000 FCFA)");
  });

  it("colonne du tableau selon le statut de la livraison et de la commande", () => {
    expect(deliveryPhase("PENDING", "IN_PROGRESS")).toBe("preparing");
    expect(deliveryPhase("ASSIGNED", "READY")).toBe("ready");
    expect(deliveryPhase("ON_THE_WAY", "READY")).toBe("on_the_way");
    expect(deliveryPhase("DELIVERED", "DELIVERED")).toBe("delivered");
    expect(deliveryPhase("FAILED", "READY")).toBe("failed");
  });

  it("transitions autorisées", () => {
    expect(canDeliveryTransition("PENDING", "ASSIGNED")).toBe(true);
    expect(canDeliveryTransition("PENDING", "ON_THE_WAY")).toBe(false);
    expect(canDeliveryTransition("ASSIGNED", "ON_THE_WAY")).toBe(true);
    expect(canDeliveryTransition("ON_THE_WAY", "ASSIGNED")).toBe(false);
    expect(canDeliveryTransition("DELIVERED", "FAILED")).toBe(false);
    expect(canDeliveryTransition("FAILED", "ASSIGNED")).toBe(true);
  });
});
