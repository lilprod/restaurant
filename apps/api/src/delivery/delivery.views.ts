import type { Prisma } from "@prisma/client";
import { deliveryPhase, type DeliveryStatus, type OrderStatus } from "@restaurant/utils";

/** Jointures d'une livraison : zone et livreur (fiche + compte). */
export const deliveryInclude = {
  zone: { select: { id: true, name: true } },
  driver: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true, phone: true } } } },
} satisfies Prisma.DeliveryInclude;
export type DeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;

/** Ce dont la vue a besoin de la commande (la commande complète, `OrderRow`, convient). */
export interface OrderLite {
  id: string; number: number; status: string; paymentStatus: string; total: number; paidAmount: number; subtotal: number; serviceCharge: number; deliveryFee: number;
  customerName: string | null; createdAt: Date; closedAt: Date | null; cancelledAt: Date | null;
  items: { name: string; quantity: number; status: string; parentItemId: string | null; formulaId: string | null }[];
}

/** Livraison seule (incluse dans la vue d'une commande). */
export function deliveryInfo(d: DeliveryRow, orderStatus: string) {
  return {
    id: d.id, status: d.status as DeliveryStatus, phase: deliveryPhase(d.status as DeliveryStatus, orderStatus as OrderStatus),
    zone: d.zone, neighborhood: d.neighborhood, address: d.address, landmark: d.landmark, phone: d.phone, fee: d.fee, eta: d.eta,
    driver: d.driver ? { id: d.driver.user.id, name: `${d.driver.user.firstName} ${d.driver.user.lastName}`.trim(), phone: d.driver.user.phone } : null,
    failReason: d.failReason, assignedAt: d.assignedAt, pickedUpAt: d.pickedUpAt, deliveredAt: d.deliveredAt, failedAt: d.failedAt,
    collectedPaymentId: d.codPaymentId, settledAt: d.settledAt, createdAt: d.createdAt,
  };
}

/** Livraison + résumé de la commande : tableau de dispatch, écran du livreur et événement `delivery.updated`. */
export function deliveryView(d: DeliveryRow, o: OrderLite) {
  const lines = o.items.filter((i) => !i.parentItemId && i.status !== "CANCELLED");
  return {
    ...deliveryInfo(d, o.status),
    order: {
      id: o.id, number: o.number, status: o.status, paymentStatus: o.paymentStatus, customerName: o.customerName,
      subtotal: o.subtotal, serviceCharge: o.serviceCharge, deliveryFee: o.deliveryFee, total: o.total, paidAmount: o.paidAmount,
      remaining: Math.max(o.total - o.paidAmount, 0), createdAt: o.createdAt, closedAt: o.closedAt, cancelledAt: o.cancelledAt,
      items: lines.map((i) => ({ name: i.name, quantity: i.quantity })),
    },
  };
}
export type DeliveryView = ReturnType<typeof deliveryView>;
