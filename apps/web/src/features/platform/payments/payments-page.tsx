import type { PaymentListItem } from "@restaurant/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Receipt, RefreshCw, SearchX, X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatFcfa, toDateInputValue } from "@/lib/format";
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS, PAYMENT_STATUS_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { papi, pk, READ_ONLY_HINT, useCanWrite } from "../hooks";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { TenantPicker } from "./tenant-picker";

const PAGE_SIZE = 20;

export function PaymentsPage() {
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tenantId, setTenantId] = useUrlParam("restaurant");
  const [method, setMethod] = useUrlParam("mode");
  const [from, setFrom] = useUrlParam("du");
  const [to, setTo] = useUrlParam("au");
  const [pageStr, setPage] = useUrlParam("page", "1");
  const page = Math.max(1, Number(pageStr) || 1);
  const createOpen = params.get("nouveau") === "1";
  const setCreateOpen = (o: boolean) => setParams((p) => { const n = new URLSearchParams(p); if (o) n.set("nouveau", "1"); else n.delete("nouveau"); return n; }, { replace: true });

  const query = {
    tenantId: tenantId || undefined, method: method || undefined,
    from: from ? `${from}T00:00:00` : undefined, to: to ? `${to}T23:59:59` : undefined,
    page, pageSize: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: pk.payments(query), queryFn: () => papi.payments.list(query), placeholderData: keepPreviousData });
  const filtered = !!(tenantId || method || from || to);

  const columns: Column<PaymentListItem>[] = [
    { key: "receipt", header: "Reçu", cell: (p) => <Link to={`/admin/paiements/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] font-medium hover:underline">{p.receiptNumber}</Link> },
    { key: "tenant", header: "Restaurant", cell: (p) => <span className="block max-w-[200px] truncate">{p.tenant.name}</span> },
    { key: "date", header: "Payé le", cell: (p) => <span className="font-mono text-xs tabular text-muted-foreground">{formatDate(p.paidAt)}</span> },
    {
      key: "method", header: "Moyen",
      cell: (p) => (
        <div className="flex flex-col">
          <span>{PAYMENT_METHOD_LABEL[p.method]}</span>
          {p.reference && <span className="font-mono text-[11px] text-muted-foreground">{p.reference}</span>}
        </div>
      ),
    },
    { key: "period", header: "Période", hideOnMobile: true, cell: (p) => <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatDate(p.periodStart)} → {formatDate(p.periodEnd)}</span> },
    { key: "status", header: "Statut", cell: (p) => <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABEL} /> },
    { key: "amount", header: "Montant", align: "right", cell: (p) => <span className={cn("font-mono font-medium tabular", p.status === "VOIDED" && "text-muted-foreground line-through")}>{formatFcfa(p.amount)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Paiements"
        description="Licences encaissées en Flooz, TMoney, carte ou espèces. Chaque paiement émet un reçu numéroté."
        actions={canWrite ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Receipt /> Enregistrer un paiement</Button>
          : <Tooltip content={READ_ONLY_HINT}><span><Button variant="primary" disabled><Receipt /> Enregistrer un paiement</Button></span></Tooltip>}
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,0.8fr)]">
          <Field label="Restaurant"><TenantPicker value={tenantId} onChange={setTenantId} placeholder="Tous les restaurants" allowClear /></Field>
          <Field label="Moyen de paiement">
            <div className="-mx-1 overflow-x-auto px-1 scrollbar-none">
              <Segmented ariaLabel="Moyen de paiement" size="sm" value={method} onChange={setMethod} className="w-auto min-w-max"
                options={[{ value: "", label: "Tous" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m]! }))]} />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3 md:col-span-2 xl:col-span-1">
            <Field label="Du"><Input type="date" value={from} max={to || toDateInputValue()} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Au"><Input type="date" value={to} min={from} max={toDateInputValue()} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="w-full text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground sm:w-auto">Total encaissé</span>
            {list.isLoading ? <Skeleton className="h-6 w-32" /> : (
              <span className="whitespace-nowrap font-mono text-xl font-semibold tabular"><AnimatedNumber value={list.data?.totalAmount ?? 0} format={formatFcfa} /></span>
            )}
            <span className="text-[13px] text-muted-foreground">{list.data ? `${list.data.total} paiement${list.data.total > 1 ? "s" : ""}` : ""}</span>
          </div>
          {filtered && <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}><X /> Effacer les filtres</Button>}
        </div>
      </Card>

      {list.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10"><p className="text-sm">{errorMessage(list.error)}</p><Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw /> Réessayer</Button></div>
      ) : (
        <DataTable
          caption="Paiements"
          rows={list.data?.items}
          loading={list.isLoading}
          columns={columns}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/admin/paiements/${p.id}`)}
          mobileCard={(p) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[13px] font-medium">{p.receiptNumber}</span>
                <span className={cn("font-mono font-semibold tabular", p.status === "VOIDED" && "text-muted-foreground line-through")}>{formatFcfa(p.amount)}</span>
              </div>
              <p className="truncate text-sm">{p.tenant.name}</p>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{PAYMENT_METHOD_LABEL[p.method]} · {formatDate(p.paidAt)}</span>
                <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABEL} />
              </div>
            </div>
          )}
          empty={filtered
            ? <EmptyState icon={<SearchX />} title="Aucun paiement pour ces filtres" action={<Button variant="secondary" onClick={() => setParams({}, { replace: true })}>Effacer les filtres</Button>} />
            : <EmptyState icon={<Receipt />} title="Aucun paiement enregistré" description="Les paiements Flooz, TMoney, carte et espèces apparaîtront ici avec leur reçu." action={canWrite ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Receipt /> Enregistrer un paiement</Button> : undefined} />}
          footer={list.data && list.data.total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setPage(String(p))} /> : undefined}
        />
      )}
      {canWrite && <RecordPaymentDialog open={createOpen} onOpenChange={setCreateOpen} tenantId={tenantId || undefined} />}
    </>
  );
}
