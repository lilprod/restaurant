import type { TenantListItem, TenantStatus } from "@restaurant/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw, Search, Store, X } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import { daysUntil, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABEL, TENANT_STATUS_LABEL } from "@/lib/labels";
import { useDebounced, useUrlParam } from "@/lib/use-url-state";
import { cn } from "@/lib/cn";
import { papi, pk, READ_ONLY_HINT, useCanWrite } from "../hooks";
import { CreateTenantDialog } from "./create-tenant-dialog";

const STATUSES = ["", "TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"] as const;
const PAGE_SIZE = 20;

export function TenantsPage() {
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useUrlParam("status");
  const [q, setQ] = useUrlParam("q");
  const [pageStr, setPage] = useUrlParam("page", "1");
  const page = Math.max(1, Number(pageStr) || 1);
  const [search, setSearch] = React.useState(q);
  const debounced = useDebounced(search, 250);
  React.useEffect(() => { if (debounced !== q) setQ(debounced); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const createOpen = params.get("nouveau") === "1";
  const setCreateOpen = (o: boolean) => setParams((p) => { const n = new URLSearchParams(p); if (o) n.set("nouveau", "1"); else n.delete("nouveau"); return n; }, { replace: true });

  const query = { status: (status || undefined) as TenantStatus | undefined, search: q || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: pk.tenants(query), queryFn: () => papi.tenants.list(query), placeholderData: keepPreviousData });

  const columns: Column<TenantListItem>[] = [
    {
      key: "name", header: "Restaurant",
      cell: (t) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-subtle text-xs font-semibold text-muted-foreground">{t.name[0]?.toUpperCase()}</span>
          <div className="flex min-w-0 flex-col">
            <Link to={`/admin/restaurants/${t.id}`} onClick={(e) => e.stopPropagation()} className="truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none">{t.name}</Link>
            <span className="truncate font-mono text-xs text-muted-foreground">{t.slug}</span>
          </div>
        </div>
      ),
    },
    { key: "status", header: "Statut", cell: (t) => <StatusBadge status={t.status} labels={TENANT_STATUS_LABEL} /> },
    { key: "plan", header: "Plan", cell: (t) => t.subscription?.plan.name ?? <span className="text-muted-foreground">—</span> },
    {
      key: "license", header: "Licence",
      cell: (t) => {
        const s = t.subscription;
        if (!s) return <span className="text-muted-foreground">—</span>;
        const days = daysUntil(s.currentPeriodEnd) ?? 0;
        return (
          <div className="flex items-center gap-2">
            <StatusBadge status={s.status} labels={SUBSCRIPTION_STATUS_LABEL} />
            <span className={cn("font-mono text-xs tabular", days < 0 ? "text-danger" : days <= 7 ? "text-warning" : "text-muted-foreground")}>
              {formatDate(s.currentPeriodEnd)}
            </span>
          </div>
        );
      },
    },
    { key: "email", header: "Contact", hideOnMobile: true, cell: (t) => <span className="truncate text-muted-foreground">{t.email}</span> },
    { key: "created", header: "Créé le", hideOnMobile: true, align: "right", cell: (t) => <span className="font-mono text-xs text-muted-foreground tabular">{formatDate(t.createdAt)}</span> },
  ];

  const filtered = !!q || !!status;

  return (
    <>
      <PageHeader
        title="Restaurants"
        description="Tous les restaurants de la plateforme, leur plan et l'état de leur licence."
        actions={canWrite
          ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus /> Créer un restaurant</Button>
          : <Tooltip content={READ_ONLY_HINT}><span><Button variant="primary" disabled><Plus /> Créer un restaurant</Button></span></Tooltip>}
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full lg:max-w-sm">
          <Input
            type="search"
            placeholder="Rechercher par nom, slug ou email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leading={<Search />}
            aria-label="Rechercher un restaurant"
            trailing={search ? <button type="button" aria-label="Effacer" onClick={() => setSearch("")} className="flex size-8 items-center justify-center rounded-md hover:bg-hover"><X className="size-4" /></button> : undefined}
          />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <Segmented
            ariaLabel="Filtrer par statut"
            size="sm"
            value={status as (typeof STATUSES)[number]}
            onChange={(v) => setStatus(v)}
            className="w-auto min-w-max"
            options={STATUSES.map((s) => ({ value: s, label: s ? TENANT_STATUS_LABEL[s]! : "Tous" }))}
          />
        </div>
      </div>

      {list.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10 text-center">
          <p className="text-sm">{errorMessage(list.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => list.refetch()}><RefreshCw /> Réessayer</Button>
        </div>
      ) : (
        <DataTable
          caption="Liste des restaurants"
          rows={list.data?.items}
          loading={list.isLoading}
          columns={columns}
          rowKey={(t) => t.id}
          onRowClick={(t) => navigate(`/admin/restaurants/${t.id}`)}
          mobileCard={(t) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{t.slug}</p>
                </div>
                <StatusBadge status={t.status} labels={TENANT_STATUS_LABEL} />
              </div>
              <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                <span>{t.subscription?.plan.name ?? "Sans plan"}</span>
                {t.subscription && <span className="font-mono text-xs">{SUBSCRIPTION_STATUS_LABEL[t.subscription.status]} · {formatDate(t.subscription.currentPeriodEnd)}</span>}
              </div>
            </div>
          )}
          empty={filtered ? (
            <EmptyState icon={<Search />} title="Aucun résultat" description="Aucun restaurant ne correspond à ces filtres."
              action={<Button variant="secondary" onClick={() => { setSearch(""); setParams({}, { replace: true }); }}>Effacer les filtres</Button>} />
          ) : (
            <EmptyState icon={<Store />} title="Aucun restaurant pour l'instant" description="Créez le premier restaurant ou validez une inscription en attente."
              action={canWrite ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus /> Créer un restaurant</Button> : undefined} />
          )}
          footer={list.data && list.data.total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setPage(String(p))} /> : undefined}
        />
      )}
      {canWrite && <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  );
}
