import type { Order, OrderItem, OrderPayment } from "@restaurant/api-client";
import { orderPaymentTone, orderStatusTone } from "@restaurant/ui-tokens";
import { computeTotals } from "@restaurant/utils";
import { useMutation } from "@tanstack/react-query";
import { MessageSquareWarning, RotateCcw, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatDateTime, formatFcfa } from "@/lib/format";
import {
  ITEM_STATUS_LABEL, ORDER_PAYMENT_METHOD_LABEL, ORDER_PAYMENT_RECORD_LABEL, ORDER_PAYMENT_STATUS_LABEL, ORDER_STATUS_LABEL,
} from "@/lib/labels";
import { useApplyOrder, useTenant } from "../hooks";

export const OrderStatusBadge = ({ status, className }: { status: string; className?: string }) =>
  <StatusBadge status={status} labels={ORDER_STATUS_LABEL} toneOf={orderStatusTone} className={className} />;
export const ItemStatusBadge = ({ status, className }: { status: string; className?: string }) =>
  <StatusBadge status={status} labels={ITEM_STATUS_LABEL} toneOf={orderStatusTone} className={className} />;
export const PaymentStatusBadge = ({ status, className }: { status: string; className?: string }) =>
  <StatusBadge status={status} labels={ORDER_PAYMENT_STATUS_LABEL} toneOf={orderPaymentTone} className={className} />;

/** « Table T3 » ou « À emporter · Awa ». */
export function orderPlace(o: Pick<Order, "type" | "table" | "customerName">): string {
  if (o.table) return `Table ${o.table.label}`;
  if (o.type === "TAKEAWAY") return o.customerName ? `À emporter · ${o.customerName}` : "À emporter";
  return o.customerName ?? "Sans table";
}

export function OrderPlace({ order, className }: { order: Pick<Order, "type" | "table" | "customerName">; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {order.type === "TAKEAWAY" && <ShoppingBag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="truncate">{orderPlace(order)}</span>
    </span>
  );
}

export const waiterName = (o: Pick<Order, "waiter">) => (o.waiter ? `${o.waiter.firstName} ${o.waiter.lastName}` : "—");

/** Options choisies et consigne d'un article. */
export function ItemDetails({ item, className }: { item: Pick<OrderItem, "options" | "instructions">; className?: string }) {
  if (!item.options.length && !item.instructions) return null;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {item.options.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          {item.options.map((o, i) => (
            <span key={o.optionId}>{i > 0 && " · "}{o.name}{o.extra > 0 && <span className="font-mono tabular-nums"> +{formatFcfa(o.extra)}</span>}</span>
          ))}
        </p>
      )}
      {item.instructions && (
        <p className="inline-flex w-fit items-start gap-1.5 rounded-md bg-[var(--tone-amber-bg)] px-2 py-1 text-[13px] font-medium text-[var(--tone-amber-fg)]">
          <MessageSquareWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden />{item.instructions}
        </p>
      )}
    </div>
  );
}

/** Addition : sous-total, service, TVA incluse par taux (calcul partagé), total, déjà payé, reste. */
export function BillSummary({ order, className, serviceChargePercent, defaultVatRate }: {
  order: Order; className?: string; serviceChargePercent: number; defaultVatRate: number;
}) {
  // Le service est figé sur la commande : il entre dans le calcul partagé comme une ligne au taux par défaut,
  // ce qui donne le même détail de TVA par taux que le ticket de l'API.
  const totals = computeTotals({
    items: [
      ...order.items.map((i) => ({ lineTotal: i.lineTotal, vatRate: i.vatRate, status: i.status })),
      { lineTotal: order.serviceCharge, vatRate: defaultVatRate, status: "PENDING" as const },
    ],
    serviceChargePercent: 0, defaultVatRate,
  });
  const row = "flex items-baseline justify-between gap-4";
  return (
    <dl className={cn("flex flex-col gap-2 text-sm", className)}>
      <div className={row}><dt className="text-muted-foreground">Sous-total</dt><dd className="font-mono tabular-nums">{formatFcfa(order.subtotal)}</dd></div>
      {order.serviceCharge > 0 && (
        <div className={row}><dt className="text-muted-foreground">Service{serviceChargePercent ? ` (${serviceChargePercent} %)` : ""}</dt><dd className="font-mono tabular-nums">{formatFcfa(order.serviceCharge)}</dd></div>
      )}
      <div className={cn(row, "border-t border-border pt-2 text-base font-semibold")}><dt>Total TTC</dt><dd className="font-mono tabular-nums">{formatFcfa(order.total)}</dd></div>
      {totals.vatBreakdown.map((v) => (
        <div key={v.rate} className={cn(row, "text-[13px] text-faint")}>
          <dt>dont TVA {v.rate} % sur {formatFcfa(v.base)}</dt><dd className="font-mono tabular-nums">{formatFcfa(v.vat)}</dd>
        </div>
      ))}
      {order.paidAmount > 0 && (
        <div className={cn(row, "border-t border-border pt-2")}><dt className="text-muted-foreground">Déjà payé</dt><dd className="font-mono tabular-nums text-success">− {formatFcfa(order.paidAmount)}</dd></div>
      )}
      {order.tip > 0 && (
        <div className={cn(row, "text-[13px]")}><dt className="text-muted-foreground">Pourboires</dt><dd className="font-mono tabular-nums">{formatFcfa(order.tip)}</dd></div>
      )}
      {!order.cancelledAt && (
        <div className={cn(row, "rounded-md bg-subtle px-3 py-2 text-base font-semibold")}>
          <dt>Reste à payer</dt><dd className={cn("font-mono tabular-nums", order.remaining > 0 ? "text-foreground" : "text-success")}>{formatFcfa(order.remaining)}</dd>
        </div>
      )}
    </dl>
  );
}

/** Paiements d'une commande, avec remboursement (responsables, motif obligatoire). */
export function PaymentsList({ order, className }: { order: Order; className?: string }) {
  const t = useTenant();
  const confirm = useConfirm();
  const apply = useApplyOrder();
  const refund = useMutation({
    mutationFn: ({ p, reason }: { p: OrderPayment; reason: string }) => t.api.orders.refund(order.id, p.id, reason),
    onSuccess: (o) => { apply(o); toast.success("Paiement remboursé", { description: o.closedAt ? undefined : "La commande est rouverte." }); },
    onError: (e) => toastError(e),
  });
  if (!order.payments.length) return <p className={cn("text-sm text-muted-foreground", className)}>Aucun paiement pour le moment.</p>;
  return (
    <ul className={cn("flex flex-col divide-y divide-border", className)}>
      {order.payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-2 text-sm font-medium">
              {ORDER_PAYMENT_METHOD_LABEL[p.method] ?? p.method}
              {p.status === "REFUNDED" && <Badge tone="red">{ORDER_PAYMENT_RECORD_LABEL.REFUNDED}</Badge>}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {formatDateTime(p.paidAt)}
              {p.reference && <> · réf. <span className="font-mono">{p.reference}</span></>}
              {p.tip > 0 && <> · pourboire <span className="font-mono">{formatFcfa(p.tip)}</span></>}
              {p.change != null && p.change > 0 && <> · rendu <span className="font-mono">{formatFcfa(p.change)}</span></>}
              {p.refundReason && <> · {p.refundReason}</>}
            </span>
          </div>
          <span className={cn("font-mono text-sm font-medium tabular-nums", p.status === "REFUNDED" && "text-faint line-through")}>{formatFcfa(p.amount)}</span>
          {t.isManager && p.status === "PAID" && (
            <Button variant="ghost" size="sm" onClick={() => confirm({
              title: `Rembourser ${formatFcfa(p.amount + p.tip)} ?`,
              description: `Le paiement ${ORDER_PAYMENT_METHOD_LABEL[p.method]} sera annulé${p.tip ? " (pourboire inclus)" : ""} et la commande n°${order.number} redeviendra à régler.`,
              confirmLabel: "Rembourser le paiement",
              reason: { label: "Motif du remboursement", placeholder: "Erreur de saisie, client mécontent…" },
              onConfirm: (reason) => refund.mutateAsync({ p, reason: reason! }),
            })}><RotateCcw /> Rembourser</Button>
          )}
        </li>
      ))}
    </ul>
  );
}
