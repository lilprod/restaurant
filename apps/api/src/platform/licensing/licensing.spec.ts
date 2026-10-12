import {
  addMonths, computeRenewal, evaluateLicense, isAccessAllowed, receiptNumber, tenantStatusFor,
} from "./licensing";

const d = (s: string) => new Date(s);

describe("addMonths", () => {
  it("conserve la fin de mois", () => {
    expect(addMonths(d("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(d("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
  it("passe l'année", () => {
    expect(addMonths(d("2026-11-15T10:00:00Z"), 3).toISOString()).toBe("2027-02-15T10:00:00.000Z");
  });
});

describe("computeRenewal", () => {
  const now = d("2026-10-15T00:00:00Z");
  it("démarre à la date du paiement si la licence est échue", () => {
    const r = computeRenewal({ now, currentPeriodEnd: d("2026-10-01T00:00:00Z"), billingCycle: "MONTHLY", periods: 1 });
    expect(r.periodStart).toEqual(now);
    expect(r.periodEnd.toISOString()).toBe("2026-11-15T00:00:00.000Z");
  });
  it("prolonge à partir de la fin de la licence en cours (paiement anticipé)", () => {
    const r = computeRenewal({ now, currentPeriodEnd: d("2026-10-20T00:00:00Z"), billingCycle: "MONTHLY", periods: 1 });
    expect(r.periodStart.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(r.periodEnd.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });
  it("gère l'annuel et plusieurs périodes", () => {
    expect(computeRenewal({ now, currentPeriodEnd: null, billingCycle: "YEARLY", periods: 2 }).periodEnd.toISOString())
      .toBe("2028-10-15T00:00:00.000Z");
    expect(computeRenewal({ now, currentPeriodEnd: null, billingCycle: "MONTHLY", periods: 3 }).periodEnd.toISOString())
      .toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("evaluateLicense", () => {
  const end = d("2026-10-01T00:00:00Z");
  it("reste active avant l'échéance", () => {
    expect(evaluateLicense({ status: "ACTIVE", currentPeriodEnd: end, graceEndsAt: null }, d("2026-09-30T00:00:00Z")).status).toBe("ACTIVE");
  });
  it("passe en grâce 7 jours après l'échéance", () => {
    const r = evaluateLicense({ status: "ACTIVE", currentPeriodEnd: end, graceEndsAt: null }, d("2026-10-03T00:00:00Z"));
    expect(r.status).toBe("GRACE");
    expect(r.graceEndsAt?.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
  it("l'essai échu passe aussi en grâce", () => {
    expect(evaluateLicense({ status: "TRIALING", currentPeriodEnd: end, graceEndsAt: null }, d("2026-10-02T00:00:00Z")).status).toBe("GRACE");
  });
  it("expire après la grâce, même sans passage intermédiaire", () => {
    expect(evaluateLicense({ status: "ACTIVE", currentPeriodEnd: end, graceEndsAt: null }, d("2026-11-01T00:00:00Z")).status).toBe("EXPIRED");
    expect(evaluateLicense({ status: "GRACE", currentPeriodEnd: end, graceEndsAt: d("2026-10-08T00:00:00Z") }, d("2026-10-09T00:00:00Z")).status).toBe("EXPIRED");
  });
  it("ne ressuscite jamais une licence annulée ou expirée", () => {
    expect(evaluateLicense({ status: "CANCELLED", currentPeriodEnd: end, graceEndsAt: null }, d("2026-09-01T00:00:00Z")).status).toBe("CANCELLED");
    expect(evaluateLicense({ status: "EXPIRED", currentPeriodEnd: end, graceEndsAt: null }, d("2026-09-01T00:00:00Z")).status).toBe("EXPIRED");
  });
});

describe("statuts tenant", () => {
  it("déduit le statut du tenant", () => {
    expect(tenantStatusFor("TRIALING", "PENDING")).toBe("TRIAL");
    expect(tenantStatusFor("ACTIVE", "TRIAL")).toBe("ACTIVE");
    expect(tenantStatusFor("GRACE", "TRIAL")).toBe("TRIAL");
    expect(tenantStatusFor("EXPIRED", "ACTIVE")).toBe("SUSPENDED");
    expect(tenantStatusFor("CANCELLED", "ACTIVE")).toBe("CANCELLED");
  });
  it("autorise l'accès pendant essai, licence et grâce uniquement", () => {
    expect(["TRIALING", "ACTIVE", "GRACE"].every((s) => isAccessAllowed(s as never))).toBe(true);
    expect(isAccessAllowed("EXPIRED")).toBe(false);
    expect(isAccessAllowed("CANCELLED")).toBe(false);
  });
});

it("formate les numéros de reçu", () => {
  expect(receiptNumber(2026, 123)).toBe("REC-2026-000123");
});
