import type { DiningTable, Order } from "@restaurant/api-client";
import { tableStatusTone } from "@restaurant/ui-tokens";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, BellRing, ClipboardList, HandPlatter, ShoppingBag, SquarePlus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ToneDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LiveIndicator } from "@/components/live-indicator";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { TABLE_STATUS_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useUser } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { elapsedLabel, useApplyOrder, useNow, useTenant } from "../hooks";
import { OrderPlace, OrderStatusBadge, PaymentStatusBadge } from "../orders/order-bits";
import { useTables } from "../tables/tables-page";

export const OPEN_ORDERS_QUERY = { open: true, pageSize: 100 } as const;

/** « Mon service » (serveurs) : commandes ouvertes, plats prêts à servir, tables, prise de commande rapide. */
export function WaiterHome() {
  const user = useUser();
  const t = useTenant();
  const to = useSpacePath();
  const now = useNow(30_000);
  const [scope, setScope] = useUrlParam("vue", "miennes");
  const orders = useQuery({ queryKey: tenantKeys.orderList(t.root, OPEN_ORDERS_QUERY), queryFn: () => t.api.orders.list(OPEN_ORDERS_QUERY) });
  const tables = useTables();

  const all = orders.data?.items ?? [];
  const mine = all.filter((o) => o.waiter?.id === user.id);
  const list = (scope === "miennes" ? mine : all).slice().sort((a, b) => readyCount(b) - readyCount(a) || +new Date(a.createdAt) - +new Date(b.createdAt));
  const ready = (scope === "miennes" ? mine : all).reduce((n, o) => n + readyCount(o), 0);
  const free = (tables.data ?? []).filter((x) => x.isActive && x.status === "FREE").length;

  return (
    <>
      <PageHeader
        eyebrow={<LiveIndicator className="w-fit" />}
        title="Mon service"
        description={`Bonjour ${user.firstName}. ${free} table${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}, ${all.length} commande${all.length > 1 ? "s" : ""} en cours.`}
        actions={
          <>
            <Button asChild variant="secondary" size="lg"><Link to={to("/commandes/nouvelle?type=TAKEAWAY")}><ShoppingBag /> À emporter</Link></Button>
            <Button asChild variant="primary" size="lg"><Link to={to("/commandes/nouvelle")}><SquarePlus /> Nouvelle commande</Link></Button>
          </>
        }
      />

      {ready > 0 && (
        <div role="status" className="mb-6 flex items-center gap-3 rounded-lg border border-[color-mix(in_oklab,var(--tone-green-dot)_35%,var(--border))] bg-[var(--tone-green-bg)] px-4 py-3 text-sm text-[var(--tone-green-fg)]">
          <BellRing className="size-4 shrink-0" />
          <span className="flex-1"><strong className="font-mono">{ready}</strong> plat{ready > 1 ? "s" : ""} prêt{ready > 1 ? "s" : ""} à servir.</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">Commandes ouvertes</h2>
            <Segmented ariaLabel="Commandes affichées" size="sm" value={scope} onChange={(v) => setScope(v)} className="sm:w-auto"
              options={[{ value: "miennes", label: `Les miennes (${mine.length})` }, { value: "toutes", label: `Toutes (${all.length})` }]} />
          </div>
          {orders.isError ? <ErrorState error={orders.error} onRetry={() => orders.refetch()} /> : orders.isLoading ? (
            <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>
          ) : list.length === 0 ? (
            <Card><EmptyState icon={<ClipboardList />} title={scope === "miennes" ? "Aucune commande à votre nom" : "Aucune commande en cours"}
              description="Les nouvelles commandes apparaissent ici en temps réel." action={<Button asChild variant="primary"><Link to={to("/commandes/nouvelle")}><SquarePlus /> Nouvelle commande</Link></Button>} /></Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((o) => <li key={o.id}><OpenOrderRow order={o} now={now} /></li>)}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold tracking-tight">Tables</h2>
            <Button asChild variant="ghost" size="sm"><Link to={to("/tables")}>Toutes les tables <ArrowRight /></Link></Button>
          </div>
          {tables.isLoading ? <Skeleton className="h-64 rounded-lg" /> : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {(tables.data ?? []).filter((x) => x.isActive).map((x) => <li key={x.id}><TableRow table={x} now={now} /></li>)}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

const readyCount = (o: Order) => o.items.filter((i) => i.status === "READY").reduce((n, i) => n + i.quantity, 0);

/** Ligne d'une commande ouverte, avec « Servir » quand des plats sont prêts. */
export function OpenOrderRow({ order, now }: { order: Order; now: number }) {
  const t = useTenant();
  const to = useSpacePath();
  const apply = useApplyOrder();
  const ready = readyCount(order);
  const serve = useMutation({
    mutationFn: () => t.api.orders.advance(order.id, "SERVED"),
    onSuccess: (o) => { apply(o); toast.success(`Commande n°${o.number} : ${ready > 1 ? "plats servis" : "plat servi"}`); },
    onError: (e) => toastError(e),
  });
  return (
    <Card className={cn("flex items-center gap-3 p-3 transition-colors hover:border-border-strong", ready > 0 && "border-[color-mix(in_oklab,var(--tone-green-dot)_45%,var(--border))]")}>
      <Link to={to(`/commandes/${order.id}`)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-md border border-border bg-subtle">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">n°</span>
          <span className="font-mono text-base font-semibold leading-none tabular-nums">{order.number}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><OrderPlace order={order} /></span>
          <span className="flex flex-wrap items-center gap-1.5">
            <OrderStatusBadge status={order.status} className="h-5 text-[11px]" />
            {order.paymentStatus !== "UNPAID" && <PaymentStatusBadge status={order.paymentStatus} className="h-5 text-[11px]" />}
            <span className="font-mono text-xs text-muted-foreground tabular-nums">{elapsedLabel(order.createdAt, now)}</span>
          </span>
        </span>
        <span className="hidden font-mono text-sm font-medium tabular-nums sm:block">{formatFcfa(order.total)}</span>
      </Link>
      {ready > 0 && t.isFloor && (
        <Button variant="primary" size="md" loading={serve.isPending} onClick={() => serve.mutate()} aria-label={`Servir ${ready} plat(s) de la commande n°${order.number}`}>
          <HandPlatter /> Servir {ready}
        </Button>
      )}
    </Card>
  );
}

/** Ligne compacte d'une table : statut (pastille + texte), commande en cours, accès direct. */
function TableRow({ table, now }: { table: DiningTable; now: number }) {
  const to = useSpacePath();
  const order = table.openOrders[0];
  const href = order ? to(`/commandes/${order.id}`) : to(`/commandes/nouvelle?table=${table.id}`);
  return (
    <Link to={href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="w-14 shrink-0 truncate text-[15px] font-semibold">{table.label}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-[13px]"><ToneDot tone={tableStatusTone(table.status)} />{TABLE_STATUS_LABEL[table.status]}</span>
        {order && <span className="truncate font-mono text-xs text-muted-foreground">n°{order.number} · {elapsedLabel(order.createdAt, now)}</span>}
      </span>
      {order ? <span className="font-mono text-[13px] tabular-nums">{formatFcfa(order.total)}</span> : <SquarePlus className="size-4 text-faint" aria-label="Nouvelle commande" />}
    </Link>
  );
}
