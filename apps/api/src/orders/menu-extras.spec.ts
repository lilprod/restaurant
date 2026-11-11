import {
  availabilityAt, bestPromotion, discountedPrice, formulaChoiceError, formulaStatus, inTimeWindow, isoWeekday, promotionActiveAt,
  type PromotionRule,
} from "@restaurant/utils";

const TZ = "Africa/Lome"; // UTC+0
const at = (iso: string) => new Date(iso);

describe("disponibilité horaire", () => {
  it("plage simple, bornes [de, à[", () => {
    expect(inTimeWindow("11:30", "15:00", 11 * 60 + 29)).toBe(false);
    expect(inTimeWindow("11:30", "15:00", 11 * 60 + 30)).toBe(true);
    expect(inTimeWindow("11:30", "15:00", 15 * 60)).toBe(false);
  });
  it("plage de nuit et absence de bornes", () => {
    expect(inTimeWindow("22:00", "02:00", 23 * 60)).toBe(true);
    expect(inTimeWindow("22:00", "02:00", 60)).toBe(true);
    expect(inTimeWindow("22:00", "02:00", 12 * 60)).toBe(false);
    expect(inTimeWindow(null, null, 5)).toBe(true);
  });
  it("tient compte du fuseau et de isAvailable", () => {
    const item = { isAvailable: true, availableFrom: "11:00", availableTo: "15:00" };
    expect(availabilityAt(item, at("2026-11-11T12:00:00Z"), TZ).available).toBe(true);
    expect(availabilityAt(item, at("2026-11-11T12:00:00Z"), "Asia/Tokyo")).toEqual({ available: false, reason: "OUT_OF_HOURS" }); // 21:00 à Tokyo
    expect(availabilityAt({ isAvailable: false }, at("2026-11-11T12:00:00Z"), TZ).reason).toBe("UNAVAILABLE");
  });
});

describe("promotions", () => {
  const base: PromotionRule = { id: "p1", name: "Happy hour", kind: "PERCENT", value: 20, menuItemId: "m1", days: [], fromTime: "17:00", toTime: "19:00" };
  it("jour ISO", () => { expect(isoWeekday("2026-11-11")).toBe(3); expect(isoWeekday("2026-11-15")).toBe(7); });
  it("période : dates, jours, heures", () => {
    const p = { ...base, startsOn: "2026-11-10", endsOn: "2026-11-12", days: [3] };
    expect(promotionActiveAt(p, at("2026-11-11T17:30:00Z"), TZ)).toBe(true);
    expect(promotionActiveAt(p, at("2026-11-11T19:00:00Z"), TZ)).toBe(false);
    expect(promotionActiveAt(p, at("2026-11-12T17:30:00Z"), TZ)).toBe(false); // jeudi
    expect(promotionActiveAt({ ...p, endsOn: "2026-11-10" }, at("2026-11-11T17:30:00Z"), TZ)).toBe(false);
    expect(promotionActiveAt({ ...p, isActive: false }, at("2026-11-11T17:30:00Z"), TZ)).toBe(false);
  });
  it("plage de nuit : après minuit on reste dans le jour de début", () => {
    const p = { ...base, fromTime: "22:00", toTime: "02:00", days: [5] }; // vendredi soir
    expect(promotionActiveAt(p, at("2026-11-14T01:00:00Z"), TZ)).toBe(true); // samedi 01:00
    expect(promotionActiveAt(p, at("2026-11-15T01:00:00Z"), TZ)).toBe(false); // dimanche 01:00
  });
  it("prix remisé entier, jamais négatif", () => {
    expect(discountedPrice(3500, "PERCENT", 20)).toBe(2800);
    expect(discountedPrice(3333, "PERCENT", 10)).toBe(3000);
    expect(discountedPrice(1000, "AMOUNT", 1500)).toBe(0);
    expect(discountedPrice(1000, "PERCENT", 100)).toBe(0);
  });
  it("meilleure promotion, plat ou catégorie, sans cumul", () => {
    const dish = { id: "m1", categoryId: "c1" };
    const t = at("2026-11-11T18:00:00Z");
    const promos: PromotionRule[] = [
      base,
      { id: "p2", name: "Catégorie", kind: "AMOUNT", value: 1000, categoryId: "c1", days: [] },
      { id: "p3", name: "Autre plat", kind: "PERCENT", value: 90, menuItemId: "m9", days: [] },
    ];
    expect(bestPromotion(3500, dish, promos, t, TZ)).toMatchObject({ promotionId: "p2", unitPrice: 2500, discountPerUnit: 1000 });
    expect(bestPromotion(3500, dish, promos, at("2026-11-11T12:00:00Z"), TZ)?.promotionId).toBe("p2");
    expect(bestPromotion(3500, { id: "m2", categoryId: "c2" }, promos, t, TZ)).toBeNull();
  });
});

describe("formules", () => {
  const steps = [
    { id: "s1", name: "Entrée", minChoices: 1, maxChoices: 1, menuItemIds: ["a", "b"] },
    { id: "s2", name: "Dessert", minChoices: 0, maxChoices: 2, menuItemIds: ["d", "e"] },
  ];
  it("valide les choix", () => {
    expect(formulaChoiceError(steps, [{ stepId: "s1", menuItemId: "a" }])).toBeNull();
    expect(formulaChoiceError(steps, [])).toMatch(/Entrée/);
    expect(formulaChoiceError(steps, [{ stepId: "s1", menuItemId: "a" }, { stepId: "s1", menuItemId: "b" }])).toMatch(/maximum/);
    expect(formulaChoiceError(steps, [{ stepId: "s1", menuItemId: "d" }])).toMatch(/pas partie/);
    expect(formulaChoiceError(steps, [{ stepId: "zz", menuItemId: "a" }])).toMatch(/inconnue/);
  });
  it("statut déduit des plats", () => {
    expect(formulaStatus([{ status: "PENDING" }, { status: "PENDING" }])).toBe("PENDING");
    expect(formulaStatus([{ status: "READY" }, { status: "PENDING" }])).toBe("IN_PROGRESS");
    expect(formulaStatus([{ status: "READY" }, { status: "SERVED" }])).toBe("READY");
    expect(formulaStatus([{ status: "SERVED" }, { status: "CANCELLED" }])).toBe("SERVED");
    expect(formulaStatus([{ status: "CANCELLED" }])).toBe("CANCELLED");
  });
});
