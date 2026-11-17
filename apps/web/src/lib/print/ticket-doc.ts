import type { OrderReceipt } from "@restaurant/api-client";
import { orderLines } from "@/lib/order-lines";

/**
 * Document de ticket indépendant du pilote : le même contenu part vers l'impression navigateur (rendu HTML 80 mm) ou vers
 * une imprimante thermique ESC/POS. Les montants du ticket caisse viennent tels quels du ticket de l'API : rien n'est recalculé.
 */
export type TicketLine =
  | { t: "text"; text: string; align?: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2 | 3 }
  | { t: "pair"; left: string; right: string; bold?: boolean; size?: 1 | 2 }
  | { t: "rule"; char?: "-" | "=" }
  | { t: "feed"; lines: number }
  | { t: "qr"; data: string };

export interface TicketDoc { kind: "kitchen" | "receipt" | "test"; lines: TicketLine[] }

const ORDER_TYPE: Record<string, string> = { DINE_IN: "Sur place", TAKEAWAY: "À emporter", DELIVERY: "Livraison" };
const PAYMENT_METHOD: Record<string, string> = { CASH: "Espèces", CARD: "Carte", FLOOZ: "Flooz", TMONEY: "T-Money", MOBILE_MONEY: "Mobile Money", OTHER: "Autre" };

/** Texte sans espaces insécables (les imprimantes thermiques ne les gèrent pas). */
export const plain = (s: string) => s.replace(/[   ]/g, " ");
const money = (v: number) => plain(new Intl.NumberFormat("fr-FR").format(v));
const dateTime = (iso: string | Date) => {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ── ticket cuisine ──
export interface KitchenTicketInput {
  /** Numéro officiel de la commande ; absent pour une commande saisie hors ligne (référence locale à la place). */
  number?: number;
  localRef?: string;
  type: string;
  tableLabel?: string | null;
  customerName?: string | null;
  waiterName?: string | null;
  notes?: string | null;
  createdAt: string;
  /** Réimpression manuelle : le ticket le précise. */
  reprint?: boolean;
  /** Ajout d'articles à une commande existante. */
  addition?: boolean;
  lines: { name: string; quantity: number; options?: string[]; instructions?: string | null; course?: number; station: string; formulaName?: string | null; stepName?: string | null }[];
}

/** Ticket cuisine : gros caractères, regroupé par poste (catégorie de la carte), consignes en gras. */
export function kitchenTicketDoc(k: KitchenTicketInput): TicketDoc {
  const L: TicketLine[] = [];
  L.push({ t: "text", text: k.addition ? "CUISINE · AJOUT" : "CUISINE", align: "center", bold: true, size: 2 });
  if (k.number == null) L.push({ t: "text", text: "HORS LIGNE", align: "center", bold: true, size: 2 });
  L.push({ t: "text", text: k.number != null ? `N° ${k.number}` : k.localRef ?? "", align: "center", bold: true, size: 3 });
  L.push({ t: "text", text: k.tableLabel ? `Table ${k.tableLabel}` : ORDER_TYPE[k.type] ?? k.type, align: "center", bold: true, size: 2 });
  if (k.customerName) L.push({ t: "text", text: k.customerName, align: "center", bold: true });
  L.push({ t: "text", text: `${dateTime(k.createdAt)}${k.waiterName ? ` · ${k.waiterName}` : ""}`, align: "center" });
  if (k.reprint) L.push({ t: "text", text: "*** RÉIMPRESSION ***", align: "center", bold: true });
  if (k.notes) L.push({ t: "text", text: `Note : ${k.notes}`, bold: true });
  const stations = [...new Set(k.lines.map((l) => l.station))];
  for (const station of stations) {
    L.push({ t: "rule", char: "=" });
    L.push({ t: "text", text: station.toUpperCase(), bold: true, size: 2 });
    const byCourse = [...new Set(k.lines.filter((l) => l.station === station).map((l) => l.course ?? 1))].sort((a, b) => a - b);
    for (const course of byCourse) {
      if (byCourse.length > 1 || course > 1) L.push({ t: "text", text: `-- Envoi ${course} --`, bold: true });
      for (const l of k.lines.filter((x) => x.station === station && (x.course ?? 1) === course)) {
        L.push({ t: "text", text: `${l.quantity} x ${l.stepName ? `${l.stepName} : ` : ""}${l.name}`, bold: true, size: 2 });
        if (l.formulaName) L.push({ t: "text", text: `   (${l.formulaName})` });
        for (const o of l.options ?? []) L.push({ t: "text", text: `   + ${o}` });
        if (l.instructions) L.push({ t: "text", text: `   !! ${l.instructions}`, bold: true });
      }
    }
  }
  L.push({ t: "rule", char: "=" });
  L.push({ t: "feed", lines: 3 });
  return { kind: "kitchen", lines: L.map((l) => (l.t === "text" ? { ...l, text: plain(l.text) } : l)) };
}

/** Entrée du ticket cuisine à partir d'une commande de l'API (création, ajout ou réimpression). `stationOf` : poste d'un plat (catégorie). */
export function kitchenInputFromOrder(
  o: { number: number; type: string; table: { label: string } | null; customerName: string | null; notes: string | null; waiter: { firstName: string } | null; createdAt: string;
    items: { id: string; menuItemId: string | null; parentItemId: string | null; stepName: string | null; name: string; quantity: number; status: string; instructions: string | null; course: number; options: { name: string }[]; createdAt: string }[] },
  stationOf: (menuItemId: string | null) => string,
  opts: { reprint?: boolean; onlyItemIds?: Set<string> } = {},
): KitchenTicketInput {
  const live = o.items.filter((i) => i.status !== "CANCELLED");
  const byId = new Map(live.map((i) => [i.id, i]));
  const lines = orderLines(live)
    .filter((i) => !i.parentItemId ? i.menuItemId !== null : true)                           // une ligne « formule » n'a pas de poste : ses plats la remplacent
    .filter((i) => !opts.onlyItemIds || opts.onlyItemIds.has(i.id) || (i.parentItemId && opts.onlyItemIds.has(i.parentItemId)))
    .map((i) => ({
      name: i.name, quantity: i.quantity, options: i.options.map((x) => x.name), instructions: i.instructions, course: i.course,
      station: stationOf(i.menuItemId), formulaName: i.parentItemId ? byId.get(i.parentItemId)?.name ?? null : null, stepName: i.stepName,
    }));
  return {
    number: o.number, type: o.type, tableLabel: o.table?.label ?? null, customerName: o.customerName, waiterName: o.waiter?.firstName ?? null,
    notes: o.notes, createdAt: o.createdAt, reprint: opts.reprint, addition: !!opts.onlyItemIds, lines,
  };
}

// ── ticket caisse ──
/** Ticket de caisse (mêmes lignes et mêmes montants que le ticket affiché : tout vient de `/orders/:id/receipt`). */
export function receiptTicketDoc(r: OrderReceipt, opts: { trackingUrl?: string } = {}): TicketDoc {
  const L: TicketLine[] = [];
  const c = (text: string, bold = false, size?: 1 | 2): TicketLine => ({ t: "text", text, align: "center", bold, size });
  L.push(c(r.restaurant.name.toUpperCase(), true, 2));
  if (r.restaurant.legalName && r.restaurant.legalName !== r.restaurant.name) L.push(c(r.restaurant.legalName));
  if (r.restaurant.address) L.push(c(r.restaurant.address));
  if (r.restaurant.phone) L.push(c(`Tél. ${r.restaurant.phone}`));
  if (r.restaurant.taxId) L.push(c(`NIF : ${r.restaurant.taxId}`));
  if (r.restaurant.registrationNumber) L.push(c(`RCCM : ${r.restaurant.registrationNumber}`));
  if (r.restaurant.headerText) L.push(c(r.restaurant.headerText));
  L.push({ t: "rule" });
  L.push({ t: "pair", left: `Commande n°${r.order.number}`, right: dateTime(r.order.createdAt), bold: true });
  L.push({ t: "text", text: `${r.order.table ? `Table ${r.order.table.label}` : ORDER_TYPE[r.order.type] ?? r.order.type}${r.order.customerName ? ` · ${r.order.customerName}` : ""}` });
  if (r.order.delivery) {
    L.push({ t: "text", text: `${r.order.delivery.neighborhood} · ${r.order.delivery.address}` });
    L.push({ t: "text", text: `Repère : ${r.order.delivery.landmark}` });
    L.push({ t: "text", text: `Tél. client : ${r.order.delivery.phone}` });
  }
  if (r.order.waiter) L.push({ t: "text", text: `Serveur : ${r.order.waiter.firstName}` });
  L.push({ t: "rule" });
  for (const i of orderLines(r.order.items.filter((x) => x.status !== "CANCELLED"))) {
    if (i.parentItemId) { L.push({ t: "text", text: `   ${i.stepName ? `${i.stepName} : ` : ""}${i.name}` }); continue; }
    L.push({ t: "pair", left: `${i.quantity} x ${i.name}`, right: money(i.lineTotal) });
    if (i.quantity > 1) L.push({ t: "text", text: `   à ${money(i.unitPrice + i.optionsExtra)}` });
    if (i.discount > 0) L.push({ t: "text", text: `   dont remise${i.promotionName ? ` « ${i.promotionName} »` : ""} : - ${money(i.discount)}` });
    for (const o of i.options) L.push({ t: "text", text: `   + ${o.name}${o.extra ? ` (${money(o.extra)})` : ""}` });
  }
  L.push({ t: "rule" });
  L.push({ t: "pair", left: "Sous-total", right: money(r.order.subtotal) });
  if (r.order.discountTotal > 0) L.push({ t: "pair", left: "  dont remises", right: `- ${money(r.order.discountTotal)}` });
  if (r.order.serviceCharge > 0) L.push({ t: "pair", left: "Service", right: money(r.order.serviceCharge) });
  if (r.order.deliveryFee > 0) L.push({ t: "pair", left: "Livraison", right: money(r.order.deliveryFee) });
  L.push({ t: "pair", left: "TOTAL TTC", right: `${money(r.order.total)} FCFA`, bold: true, size: 2 });
  for (const v of r.vatBreakdown) L.push({ t: "pair", left: `TVA ${v.rate} % (base ${money(v.base)})`, right: money(v.vat) });
  const paid = r.order.payments.filter((p) => p.status === "PAID");
  if (paid.length) {
    L.push({ t: "rule" });
    for (const p of paid) {
      L.push({ t: "pair", left: `${PAYMENT_METHOD[p.method] ?? p.method}${p.reference ? ` ${p.reference}` : ""}`, right: money(p.amount) });
      if (p.tip > 0) L.push({ t: "pair", left: "  Pourboire", right: money(p.tip) });
      if (p.tendered != null) L.push({ t: "pair", left: "  Remis", right: money(p.tendered) });
      if (p.change != null && p.change > 0) L.push({ t: "pair", left: "  Rendu", right: money(p.change) });
    }
    if (r.order.remaining > 0) L.push({ t: "pair", left: "Reste à payer", right: money(r.order.remaining), bold: true });
  }
  if (opts.trackingUrl) {
    L.push({ t: "rule" });
    L.push({ t: "qr", data: opts.trackingUrl });
    L.push(c("Suivez votre commande et donnez votre avis : scannez ce code."));
  }
  L.push({ t: "rule" });
  L.push(c(r.restaurant.footerText || "Merci de votre visite !"));
  L.push(c(`Montants en ${r.currency === "XOF" ? "FCFA" : r.currency} · imprimé le ${dateTime(r.printedAt)}`));
  L.push({ t: "feed", lines: 3 });
  return { kind: "receipt", lines: L.map((l) => (l.t === "text" ? { ...l, text: plain(l.text) } : l.t === "pair" ? { ...l, left: plain(l.left), right: plain(l.right) } : l)) };
}

/** Page d'essai (réglages d'imprimante). */
export function testTicketDoc(deviceLabel: string): TicketDoc {
  return {
    kind: "test",
    lines: [
      { t: "text", text: "TEST D'IMPRESSION", align: "center", bold: true, size: 2 },
      { t: "text", text: deviceLabel, align: "center" },
      { t: "rule" },
      { t: "text", text: "Accents : é è ê à ç ô î ù œ « »" },
      { t: "pair", left: "Poulet braisé × 2", right: "9 500" },
      { t: "text", text: "Gros caractères", bold: true, size: 2 },
      { t: "rule" },
      { t: "feed", lines: 3 },
    ],
  };
}
