/**
 * Compléments du menu (P1B) : disponibilité horaire des plats et formules, promotions, choix de formule.
 * Logique pure partagée par l'API (source de vérité) et les interfaces (grisé, prix affiché). Heures dans le fuseau du restaurant.
 */
import { zonedDay } from "./time";

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** « HH:MM » → minutes depuis minuit (null si absent ou invalide). */
export function parseHm(hm: string | null | undefined): number | null {
  const m = hm ? HM.exec(hm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Minutes écoulées depuis minuit, heure locale du fuseau. */
export function zonedMinutes(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const v = Object.fromEntries(p.map((x) => [x.type, Number(x.value)]));
  return v.hour * 60 + v.minute;
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'un jour AAAA-MM-JJ. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Plage horaire [de, à[ ; une plage qui passe minuit (22:00–02:00) est acceptée. Sans borne : toujours vrai. */
export function inTimeWindow(from: string | null | undefined, to: string | null | undefined, minutes: number): boolean {
  const a = parseHm(from);
  const b = parseHm(to);
  if (a === null || b === null || a === b) return true;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

export type Unavailable = "UNAVAILABLE" | "OUT_OF_HOURS";
export interface Schedulable { isAvailable?: boolean; availableFrom?: string | null; availableTo?: string | null }

/** Un plat (ou une formule) est-il commandable à cet instant ? `reason` explique le refus. */
export function availabilityAt(item: Schedulable, at: Date, timeZone: string): { available: boolean; reason: Unavailable | null } {
  if (item.isAvailable === false) return { available: false, reason: "UNAVAILABLE" };
  if (!inTimeWindow(item.availableFrom, item.availableTo, zonedMinutes(at, timeZone))) return { available: false, reason: "OUT_OF_HOURS" };
  return { available: true, reason: null };
}

/** Message affichable pour une plage (« de 11:30 à 15:00 »). */
export function hoursLabel(from: string | null | undefined, to: string | null | undefined): string | null {
  return parseHm(from) !== null && parseHm(to) !== null ? `de ${from} à ${to}` : null;
}

// ── Promotions ──

export type PromotionKind = "PERCENT" | "AMOUNT";
export interface PromotionRule {
  id: string;
  name: string;
  kind: PromotionKind;
  /** % (1–100) ou FCFA par unité. */
  value: number;
  menuItemId?: string | null;
  categoryId?: string | null;
  /** AAAA-MM-JJ, inclus, fuseau du restaurant. */
  startsOn?: string | null;
  endsOn?: string | null;
  /** Jours ISO 1–7 ; vide = tous les jours. */
  days?: number[];
  fromTime?: string | null;
  toTime?: string | null;
  isActive?: boolean;
}

/** La promotion est-elle en cours à cet instant (dates, jours, heures dans le fuseau du restaurant) ? */
export function promotionActiveAt(p: PromotionRule, at: Date, timeZone: string): boolean {
  if (p.isActive === false) return false;
  const minutes = zonedMinutes(at, timeZone);
  if (!inTimeWindow(p.fromTime, p.toTime, minutes)) return false;
  // Après minuit dans une plage de nuit, on est encore dans la journée de début de la promotion.
  const a = parseHm(p.fromTime);
  const b = parseHm(p.toTime);
  const spillsOver = a !== null && b !== null && a > b && minutes < b;
  const day = zonedDay(spillsOver ? new Date(at.getTime() - 24 * 3600_000) : at, timeZone);
  if (p.startsOn && day < p.startsOn) return false;
  if (p.endsOn && day > p.endsOn) return false;
  if (p.days?.length && !p.days.includes(isoWeekday(day))) return false;
  return true;
}

/** Prix unitaire TTC après remise (jamais négatif, arrondi au franc). */
export function discountedPrice(price: number, kind: PromotionKind, value: number): number {
  const off = kind === "PERCENT" ? Math.round((price * Math.min(value, 100)) / 100) : value;
  return Math.max(0, price - Math.min(off, price));
}

export interface AppliedPromotion { promotionId: string; name: string; unitPrice: number; discountPerUnit: number }

/** Meilleure promotion en cours pour un plat (pas de cumul : la plus avantageuse l'emporte, puis l'ordre de la liste). */
export function bestPromotion(
  price: number, dish: { id: string; categoryId: string }, promotions: PromotionRule[], at: Date, timeZone: string,
): AppliedPromotion | null {
  let best: AppliedPromotion | null = null;
  for (const p of promotions) {
    if (p.menuItemId ? p.menuItemId !== dish.id : p.categoryId !== dish.categoryId) continue;
    if (!promotionActiveAt(p, at, timeZone)) continue;
    const unitPrice = discountedPrice(price, p.kind, p.value);
    const discountPerUnit = price - unitPrice;
    if (discountPerUnit > 0 && (!best || discountPerUnit > best.discountPerUnit)) best = { promotionId: p.id, name: p.name, unitPrice, discountPerUnit };
  }
  return best;
}

/** Libellé court d'une remise : « -20 % » ou « -500 FCFA ». */
export function promotionLabel(kind: PromotionKind, value: number): string {
  return kind === "PERCENT" ? `-${value} %` : `-${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
}

// ── Formules ──

export interface FormulaStepRule { id: string; name: string; minChoices: number; maxChoices: number; menuItemIds: string[] }
export interface FormulaChoice { stepId: string; menuItemId: string }

/** Vérifie les choix d'un client contre les étapes d'une formule ; renvoie un message français ou null. */
export function formulaChoiceError(steps: FormulaStepRule[], choices: FormulaChoice[]): string | null {
  const known = new Set(steps.map((s) => s.id));
  if (choices.some((c) => !known.has(c.stepId))) return "Étape inconnue pour cette formule";
  for (const s of steps) {
    const mine = choices.filter((c) => c.stepId === s.id);
    if (new Set(mine.map((c) => c.menuItemId)).size !== mine.length) return `« ${s.name} » : un même plat ne peut être choisi qu'une fois`;
    if (mine.some((c) => !s.menuItemIds.includes(c.menuItemId))) return `« ${s.name} » : ce plat ne fait pas partie des choix proposés`;
    if (mine.length < s.minChoices) return `« ${s.name} » : choisissez ${s.minChoices === 1 ? "un plat" : `${s.minChoices} plats`}`;
    if (mine.length > s.maxChoices) return `« ${s.name} » : ${s.maxChoices} choix maximum`;
  }
  return null;
}

/** Statut d'une ligne formule déduit de ses plats (mêmes règles que le statut d'une commande). */
export function formulaStatus(children: { status: string }[]): "PENDING" | "IN_PROGRESS" | "READY" | "SERVED" | "CANCELLED" {
  const live = children.filter((c) => c.status !== "CANCELLED");
  if (!live.length) return "CANCELLED";
  if (live.every((c) => c.status === "SERVED")) return "SERVED";
  if (live.every((c) => c.status === "READY" || c.status === "SERVED")) return "READY";
  if (live.every((c) => c.status === "PENDING")) return "PENDING";
  return "IN_PROGRESS";
}
