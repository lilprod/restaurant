import type { Order, OrdersQuery } from "@restaurant/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardList, SquarePlus, X } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { LiveIndicator } from "@/components/live-indicator";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatFcfa, formatRelative, formatTime } from "@/lib/format";
import { ORDER_PAYMENT_STATUS_LABEL, ORDER_STATUS_LABEL, ORDER_TYPE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { elapsedLabel, useNow, useTenant } from "../hooks";
import { OrderPlace, OrderStatusBadge, PaymentStatusBadge, waiterName } from "./order-bits";

const PAGE_SIZE = 30;
type View = "en-cours" | "terminees" | "toutes";

export function OrdersPage() {
  const t = useTenant();
  const to = useSpacePath();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const [view, setView] = useUrlParam("vue", "en-cours");
  const [status, setStatus] = useUrlParam("statut", "");
  const [payment, setPayment] = useUrlParam("paiement", "");
  const [type, setType] = useUrlParam("type", "");
  const [date, setDate] = useUrlParam("date", "");
  const [page, setPage] = useUrlParam("page", "1");

  const query: OrdersQuery = React.useMemo(() => ({
    open: view === "en-cours" ? true : view === "terminees" ? false : undefined,
    status: (status || undefined) as OrdersQuery["status"],
    paymentStatus: (payment || undefined) as OrdersQuery["paymentStatus"],
    type: (type || undefined) as OrdersQuery["type"],
    date: date || undefined,
    page: Number(page) || 1,
    pageSize: PAGE_SIZE,
  }), [view, status, payment, type, date, page]);
  // Clé stable (sans les undefined) : le temps réel retrouve la liste et la met à jour sur place.
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as OrdersQuery;
  const q = useQuery({ queryKey: tenantKeys.orderList(t.root, clean), queryFn: () => t.api.orders.list(clean), placeholderData: keepPreviousData });
  const filtered = !!(status || payment || type || date);

  const columns: Column<Order>[] = [
    { key: "n", header: "N°", cell: (o) => <span className="font-mono font-semibold tabular-nums">{o.number}</span>, className: "w-16" },
    { key: "place", header: "Table / client", cell: (o) => <OrderPlace order={o} className="max-w-[200px] font-medium" /> },
    { key: "waiter", header: "Serveur", cell: (o) => <span className="text-muted-foreground">{waiterName(o)}</span>, hideOnMobile: true },
    { key: "status", header: "Statut", cell: (o) => <OrderStatusBadge status={o.status} /> },
    { key: "pay", header: "Paiement", cell: (o) => <PaymentStatusBadge status={o.paymentStatus} /> },
    { key: "total", header: "Total", align: "right", cell: (o) => (
      <span className="flex flex-col items-end">
        <span className="font-mono font-medium tabular-nums">{formatFcfa(o.total)}</span>
        {o.remaining > 0 && o.paymentStatus === "PARTIAL" && <span className="font-mono text-xs text-muted-foreground tabular-nums">reste {formatFcfa(o.remaining)}</span>}
      </span>
    ) },
    { key: "time", header: "Créée", align: "right", cell: (o) => (
      <span className="flex flex-col items-end text-[13px]">
        <span className="font-mono tabular-nums">{formatTime(o.createdAt)}</span>
        <span className="text-xs text-muted-foreground">{formatRelative(o.createdAt, now)}</span>
      </span>
    ) },
  ];

  return (
    <>
      <PageHeader
        eyebrow={<LiveIndicator className="w-fit" />}
        title="Commandes"
        description="Toutes les commandes du restaurant, mises à jour en temps réel."
        actions={t.isFloor && <Button asChild variant="primary"><Link to={to("/commandes/nouvelle")}><SquarePlus /> Nouvelle commande</Link></Button>}
      />
      <div className="mb-4 flex flex-col gap-3">
        <Segmented<View> ariaLabel="Commandes affichées" size="sm" value={view as View} onChange={(v) => setView(v)} className="sm:w-fit"
          options={[{ value: "en-cours", label: "En cours" }, { value: "terminees", label: "Terminées" }, { value: "toutes", label: "Toutes" }]} />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <FilterSelect label="Statut" value={status} onChange={setStatus} options={ORDER_STATUS_LABEL} />
          <FilterSelect label="Paiement" value={payment} onChange={setPayment} options={ORDER_PAYMENT_STATUS_LABEL} />
          <FilterSelect label="Type" value={type} onChange={setType} options={{ DINE_IN: ORDER_TYPE_LABEL.DINE_IN!, TAKEAWAY: ORDER_TYPE_LABEL.TAKEAWAY! }} />
          <div className="sm:w-44">
            <label htmlFor="orders-date" className="sr-only">Date</label>
            <Input id="orders-date" type="date" value={date} onChange={(e) => setDate(e.target.value || null)} className={cn("font-mono", !date && "text-muted-foreground")} />
          </div>
          {filtered && (
            <Button variant="ghost" size="sm" className="col-span-2 sm:col-span-1" onClick={() => { setStatus(null); setPayment(null); setType(null); setDate(null); }}>
              <X /> Effacer les filtres
            </Button>
          )}
        </div>
      </div>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <DataTable
          caption="Commandes"
          rows={q.data?.items}
          loading={q.isLoading}
          columns={columns}
          rowKey={(o) => o.id}
          onRowClick={(o) => navigate(to(`/commandes/${o.id}`))}
          mobileCard={(o) => (
            <div className="flex items-start gap-3">
              <span className="font-mono text-lg font-semibold tabular-nums">{o.number}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <OrderPlace order={o} className="font-medium" />
                  <span className="shrink-0 font-mono text-sm font-medium tabular-nums">{formatFcfa(o.total)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <OrderStatusBadge status={o.status} /><PaymentStatusBadge status={o.paymentStatus} />
                  <span className="text-xs text-muted-foreground">{waiterName(o)} · {elapsedLabel(o.createdAt, now)}</span>
                </div>
              </div>
            </div>
          )}
          empty={<EmptyState icon={<ClipboardList />} title={view === "en-cours" && !filtered ? "Aucune commande en cours" : "Aucune commande"}
            description={filtered ? "Aucune commande ne correspond à ces filtres." : "Les commandes prises en salle apparaissent ici en temps réel."}
            action={t.isFloor ? <Button asChild variant="primary"><Link to={to("/commandes/nouvelle")}><SquarePlus /> Nouvelle commande</Link></Button> : undefined} />}
          footer={q.data && q.data.total > PAGE_SIZE ? <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setPage(String(p))} /> : undefined}
        />
      )}
    </>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string | null) => void; options: Record<string, string> }) {
  const id = React.useId();
  return (
    <div className="sm:w-44">
      <label htmlFor={id} className="sr-only">{label}</label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value || null)} className={cn(!value && "text-muted-foreground")}>
        <option value="">{label} : tous</option>
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </NativeSelect>
    </div>
  );
}
