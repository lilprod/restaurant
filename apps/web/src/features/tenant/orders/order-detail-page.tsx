import type { Order, OrderItem } from "@restaurant/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Ban, Banknote, ChevronRight, HandPlatter, MoreHorizontal, NotebookPen, Plus, Printer, Undo2, XCircle,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { DishImage } from "@/components/dish-image";
import { LiveIndicator } from "@/components/live-indicator";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatDateTime, formatFcfa, formatTime } from "@/lib/format";
import { courseLabel, ORDER_TYPE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { elapsedLabel, useApplyOrder, useNow, useOperations, useTenant } from "../hooks";
import {
  BillSummary, ItemDetails, ItemStatusBadge, OrderPlace, OrderStatusBadge, PaymentsList, PaymentStatusBadge, waiterName,
} from "./order-bits";

/** Commande (cache partagé avec le temps réel). */
export function useOrder(id: string | undefined) {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.order(t.root, id ?? ""), queryFn: () => t.api.orders.get(id!), enabled: !!id });
}

export function OrderDetailPage() {
  const { id } = useParams();
  const t = useTenant();
  const to = useSpacePath();
  const ops = useOperations();
  const confirm = useConfirm();
  const apply = useApplyOrder();
  const now = useNow(15_000);
  const q = useOrder(id);
  const o = q.data;

  const serveAll = useMutation({
    mutationFn: () => t.api.orders.advance(o!.id, "SERVED"),
    onSuccess: (r) => { apply(r); toast.success("Plats prêts marqués servis"); },
    onError: (e) => toastError(e),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => t.api.orders.cancel(o!.id, reason),
    onSuccess: (r) => { apply(r); toast.success(`Commande n°${r.number} annulée`); },
    onError: (e) => toastError(e),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!o) return <DetailSkeleton />;

  const open = !o.closedAt && !o.cancelledAt;
  const live = o.items.filter((i) => i.status !== "CANCELLED");
  const readyQty = o.items.filter((i) => i.status === "READY").reduce((n, i) => n + i.quantity, 0);
  const courses = [...new Set(o.items.map((i) => i.course))].sort((a, b) => a - b);
  const hasPaid = o.payments.some((p) => p.status === "PAID");

  return (
    <div className="flex flex-col gap-6">
      <div className="-mb-2 flex items-center justify-between gap-3">
        <nav aria-label="Fil d'Ariane" className="flex items-center gap-1 text-[13px] text-muted-foreground">
          <Link to={to("/commandes")} className="inline-flex min-h-11 items-center gap-1 hover:text-foreground sm:min-h-0"><ArrowLeft className="size-3.5" /> Commandes</Link>
          <ChevronRight className="size-3.5 text-faint" /><span className="text-foreground">n°{o.number}</span>
        </nav>
        {open && <LiveIndicator />}
      </div>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">Commande <span className="font-mono">n°{o.number}</span></h1>
            <OrderStatusBadge status={o.status} />
            <PaymentStatusBadge status={o.paymentStatus} />
          </div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <OrderPlace order={o} className="font-medium text-foreground" />
            <span aria-hidden>·</span><span>{ORDER_TYPE_LABEL[o.type]}</span>
            <span aria-hidden>·</span><span>Serveur : {waiterName(o)}</span>
            <span aria-hidden>·</span>
            <span>Créée à <span className="font-mono">{formatTime(o.createdAt)}</span>{open && <>, depuis <span className="font-mono text-foreground">{elapsedLabel(o.createdAt, now)}</span></>}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.isFloor && open && <Button asChild variant="secondary"><Link to={to(`/commandes/${o.id}/ajouter`)}><Plus /> Ajouter des articles</Link></Button>}
          {t.isFloor && <Button asChild variant="secondary"><Link to={to(`/commandes/${o.id}/ticket`)}><Printer /> Ticket</Link></Button>}
          {t.isFloor && !o.cancelledAt && o.remaining > 0 && (
            <Button asChild variant="primary" className="order-first w-full sm:order-none sm:w-auto"><Link to={to(`/commandes/${o.id}/encaisser`)}><Banknote /> Encaisser {formatFcfa(o.remaining)}</Link></Button>
          )}
          {t.isManager && !o.cancelledAt && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Plus d'actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem destructive disabled={hasPaid} onSelect={() => confirm({
                  title: `Annuler la commande n°${o.number} ?`,
                  description: "Tous les articles seront annulés, la cuisine ne les verra plus et la table sera libérée.",
                  confirmLabel: "Annuler la commande",
                  reason: { label: "Motif de l'annulation", placeholder: "Client parti, erreur de saisie…" },
                  onConfirm: (reason) => cancel.mutateAsync(reason!),
                })}><Ban /> Annuler la commande</DropdownMenuItem>
                {hasPaid && <p className="max-w-[240px] px-2.5 pb-2 text-xs text-muted-foreground">Remboursez d'abord les paiements encaissés.</p>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {o.cancelledAt && <Callout tone="danger" title={`Commande annulée le ${formatDateTime(o.cancelledAt)}`}>{o.cancelReason}</Callout>}
      {o.closedAt && !o.cancelledAt && <Callout tone="success" title="Commande clôturée">Servie et réglée le {formatDateTime(o.closedAt)}{o.table ? " ; la table a été libérée." : "."}</Callout>}

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
            <h2 className="text-[15px] font-semibold tracking-tight">Articles <span className="font-mono text-muted-foreground">({live.reduce((n, i) => n + i.quantity, 0)})</span></h2>
            {t.isFloor && readyQty > 0 && (
              <Button variant="primary" size="sm" loading={serveAll.isPending} onClick={() => serveAll.mutate()}><HandPlatter /> Tout servir ({readyQty})</Button>
            )}
          </div>
          {o.notes && <p className="flex items-start gap-2 border-b border-border bg-subtle px-4 py-3 text-sm sm:px-5"><NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{o.notes}</p>}
          {courses.map((c) => (
            <section key={c} aria-label={courseLabel(c)}>
              {courses.length > 1 && <h3 className="border-b border-border bg-subtle px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:px-5">{courseLabel(c)}</h3>}
              <ul className="divide-y divide-border">
                {o.items.filter((i) => i.course === c).map((i) => <ItemRow key={i.id} order={o} item={i} />)}
              </ul>
            </section>
          ))}
        </Card>

        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card className="p-5">
            <h2 className="mb-4 text-[15px] font-semibold tracking-tight">Addition</h2>
            <BillSummary order={o} serviceChargePercent={ops.serviceChargePercent} defaultVatRate={ops.defaultVatRate} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-semibold tracking-tight">Paiements</h2>
            <PaymentsList order={o} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ order, item }: { order: Order; item: OrderItem }) {
  const t = useTenant();
  const confirm = useConfirm();
  const apply = useApplyOrder();
  const cancelled = item.status === "CANCELLED";
  const setStatus = useMutation({
    mutationFn: (s: "SERVED" | "READY") => t.api.orders.setItemStatus(order.id, item.id, s),
    onSuccess: (r) => apply(r),
    onError: (e) => toastError(e),
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => t.api.orders.cancelItem(order.id, item.id, reason),
    onSuccess: (r) => { apply(r); toast.success(`« ${item.name} » annulé`); },
    onError: (e) => toastError(e),
  });
  const paid = item.paidQuantity > 0;
  const canCancel = t.isFloor && !cancelled && !order.cancelledAt && !paid && (item.status === "PENDING" || t.isManager);
  const cancelHint = paid ? "Article déjà encaissé : remboursez d'abord le paiement" : !t.isManager && item.status !== "PENDING" ? "Déjà lancé en cuisine : un responsable peut l'annuler" : null;

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3 sm:px-5", cancelled && "bg-subtle")}>
      <DishImage src={item.imageUrl} className="hidden size-11 shrink-0 rounded-md sm:flex" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <p className={cn("text-sm font-medium", cancelled && "text-muted-foreground line-through")}>
            <span className="font-mono tabular-nums">{item.quantity}×</span> {item.name}
          </p>
          <span className={cn("shrink-0 font-mono text-sm tabular-nums", cancelled && "text-faint line-through")}>{formatFcfa(item.lineTotal)}</span>
        </div>
        <ItemDetails item={item} />
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <ItemStatusBadge status={item.status} />
          {paid && <span className="text-xs text-success">{item.paidQuantity === item.quantity ? "Encaissé" : `${item.paidQuantity}/${item.quantity} encaissé`}</span>}
          {cancelled && item.cancelReason && <span className="text-xs text-muted-foreground">Motif : {item.cancelReason}</span>}
          {item.servedAt && item.status === "SERVED" && <span className="font-mono text-xs text-faint">servi à {formatTime(item.servedAt)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {t.isFloor && item.status === "READY" && (
          <Button variant="primary" size="sm" loading={setStatus.isPending} onClick={() => setStatus.mutate("SERVED")}><HandPlatter /> Servi</Button>
        )}
        {t.isFloor && item.status === "SERVED" && !order.closedAt && (
          <Tooltip content="Annuler « servi » (erreur de manipulation)">
            <Button variant="ghost" size="icon-sm" aria-label={`Remettre « ${item.name} » à servir`} onClick={() => setStatus.mutate("READY")}><Undo2 /></Button>
          </Tooltip>
        )}
        {t.isFloor && !cancelled && !order.cancelledAt && (
          canCancel ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Annuler « ${item.name} »`} onClick={() => confirm({
              title: `Annuler « ${item.name} » ?`,
              description: item.status === "PENDING" ? "L'article sera retiré de la commande et de l'écran cuisine." : "L'article est déjà lancé en cuisine : il sera retiré et ne sera pas facturé.",
              confirmLabel: "Annuler l'article",
              reason: { label: "Motif", placeholder: "Erreur de saisie, client a changé d'avis…" },
              onConfirm: (reason) => cancel.mutateAsync(reason!),
            })}><XCircle /></Button>
          ) : cancelHint && (
            <Tooltip content={cancelHint}><span tabIndex={0} aria-label={cancelHint}><Button variant="ghost" size="icon-sm" disabled aria-hidden tabIndex={-1}><XCircle /></Button></span></Tooltip>
          )
        )}
      </div>
    </li>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-9 w-72" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-lg lg:col-span-2" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}
