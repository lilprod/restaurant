import { GRACE_DAYS } from "@restaurant/shared-types";
import type { BillingCycle, SubscriptionStatus, TenantStatus } from "@restaurant/shared-types";

/** Règles métier des licences : fonctions pures, sans accès base, testées unitairement. */

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Ajoute des mois en conservant la fin de mois (31 janv. + 1 mois = 28/29 févr.). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export interface Renewal {
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Période couverte par un paiement.
 * - licence encore valide (essai compris) : la nouvelle période commence à la fin de l'actuelle,
 *   le client ne perd donc pas de jours en payant en avance ;
 * - licence échue ou inexistante : elle commence à la date du paiement.
 */
export function computeRenewal(args: {
  now: Date;
  currentPeriodEnd: Date | null;
  billingCycle: BillingCycle;
  periods: number;
}): Renewal {
  const { now, currentPeriodEnd, billingCycle, periods } = args;
  const periodStart = currentPeriodEnd && currentPeriodEnd > now ? currentPeriodEnd : now;
  const months = (billingCycle === "YEARLY" ? 12 : 1) * periods;
  return { periodStart, periodEnd: addMonths(periodStart, months) };
}

export interface LicenseState {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
}

/** Statut d'une licence à l'instant `now` (appelé par la tâche planifiée). */
export function evaluateLicense(
  sub: LicenseState,
  now: Date,
  graceDays: number = GRACE_DAYS,
): { status: SubscriptionStatus; graceEndsAt: Date | null } {
  if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
    return { status: sub.status, graceEndsAt: sub.graceEndsAt };
  }
  if (sub.status === "TRIALING" || sub.status === "ACTIVE") {
    if (now <= sub.currentPeriodEnd) return { status: sub.status, graceEndsAt: null };
    const graceEndsAt = addDays(sub.currentPeriodEnd, graceDays);
    return now <= graceEndsAt
      ? { status: "GRACE", graceEndsAt }
      : { status: "EXPIRED", graceEndsAt };
  }
  // GRACE
  const graceEndsAt = sub.graceEndsAt ?? addDays(sub.currentPeriodEnd, graceDays);
  return now <= graceEndsAt ? { status: "GRACE", graceEndsAt } : { status: "EXPIRED", graceEndsAt };
}

/** Statut du tenant déduit de sa licence. Pendant la grâce, le statut du tenant ne change pas. */
export function tenantStatusFor(sub: SubscriptionStatus, current: TenantStatus): TenantStatus {
  switch (sub) {
    case "TRIALING":
      return "TRIAL";
    case "ACTIVE":
      return "ACTIVE";
    case "GRACE":
      return current;
    case "EXPIRED":
      return "SUSPENDED";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/** Le tenant peut-il utiliser l'application ? (essai, licence active ou période de grâce) */
export function isAccessAllowed(sub: SubscriptionStatus): boolean {
  return sub === "TRIALING" || sub === "ACTIVE" || sub === "GRACE";
}

export function receiptNumber(year: number, n: number): string {
  return `REC-${year}-${String(n).padStart(6, "0")}`;
}
