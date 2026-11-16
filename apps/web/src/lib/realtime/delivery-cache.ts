import type { Delivery, DeliveryBoard } from "@restaurant/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { tenantKeys } from "../tenant-keys";

/** Insère, remplace ou retire une livraison d'une liste (tableau de dispatch ou « Mes livraisons »). */
export function upsertDelivery(board: DeliveryBoard, d: Delivery, keep: boolean): DeliveryBoard {
  const rest = board.items.filter((x) => x.id !== d.id);
  if (!keep) return rest.length === board.items.length ? board : { ...board, items: rest };
  const at = board.items.findIndex((x) => x.id === d.id);
  if (at >= 0) return { ...board, items: board.items.map((x, i) => (i === at ? d : x)) };
  return { ...board, items: [...rest, d].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) };
}

/**
 * Événement `delivery.updated` : met à jour en place le tableau de dispatch (tout le restaurant) et « Mes livraisons »
 * (seulement celles attribuées à `me`). Une commande annulée sort du tableau. Les rapprochements et livreurs sont rechargés.
 */
export function applyDeliveryEvent(qc: QueryClient, root: readonly unknown[], d: Delivery, me?: string) {
  qc.setQueryData<DeliveryBoard>(tenantKeys.deliveryBoard(root), (b) => (b ? upsertDelivery(b, d, !d.order.cancelledAt) : b));
  qc.setQueryData<DeliveryBoard>(tenantKeys.deliveryMine(root), (b) => (b ? upsertDelivery(b, d, !d.order.cancelledAt && !!me && d.driver?.id === me) : b));
  qc.setQueryData(tenantKeys.delivery(root, d.id), d);
  void qc.invalidateQueries({ queryKey: tenantKeys.deliverySettlements(root) });
  void qc.invalidateQueries({ queryKey: tenantKeys.deliveryDrivers(root) });
}
