import type { KitchenTicketInput } from "@/lib/print/ticket-doc";
import type { CartLine } from "./cart";

/** Ticket cuisine d'un panier saisi hors ligne (pas encore de numéro de commande : la référence locale en tient lieu). */
export function kitchenInputFromCart(lines: CartLine[], ctx: {
  type: string; tableLabel?: string | null; customerName?: string | null; waiterName?: string | null; notes?: string | null;
  localRef: string; stationOf: (menuItemId: string | null) => string; now?: Date; addition?: boolean; number?: number;
}): KitchenTicketInput {
  type Line = KitchenTicketInput["lines"][number];
  return {
    number: ctx.number, localRef: ctx.localRef, type: ctx.type, tableLabel: ctx.tableLabel ?? null, customerName: ctx.customerName || null,
    waiterName: ctx.waiterName ?? null, notes: ctx.notes || null, createdAt: (ctx.now ?? new Date()).toISOString(), addition: ctx.addition,
    lines: lines.flatMap((l): Line[] => l.formulaId
      ? (l.choices ?? []).map((c) => ({ name: c.name, quantity: l.quantity, options: [], instructions: l.instructions || null, course: l.course, station: ctx.stationOf(c.menuItemId), formulaName: l.name, stepName: c.stepName }))
      : [{ name: l.name, quantity: l.quantity, options: l.options.map((o) => o.name), instructions: l.instructions || null, course: l.course, station: ctx.stationOf(l.menuItemId), formulaName: null, stepName: null }]),
  };
}
