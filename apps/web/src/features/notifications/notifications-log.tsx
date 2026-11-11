import type { NotificationList, NotificationLogItem, NotificationsQuery } from "@restaurant/api-client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Mail, MessageSquare, RefreshCw, RotateCw, SearchX, X } from "lucide-react";
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { NOTIFICATION_CHANNEL_LABEL, NOTIFICATION_STATUS_LABEL, NOTIFICATION_TEMPLATE_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";

const PAGE_SIZE = 20;

export interface NotificationsApi {
  list: (q: NotificationsQuery) => Promise<NotificationList>;
  resend: (id: string) => Promise<{ id: string }>;
}

/**
 * Journal des messages (email / SMS), partagé par l'espace restaurant et l'espace plateforme.
 * Les destinataires arrivent déjà masqués de l'API ; le renvoi n'est proposé que pour les messages non confidentiels.
 */
export function NotificationsLog({ api, queryRoot, canResend, showTenant = false, extraFilter }: {
  api: NotificationsApi;
  /** Préfixe des clés de requête (purge à la déconnexion). */
  queryRoot: readonly unknown[];
  canResend: boolean;
  showTenant?: boolean;
  /** Filtre supplémentaire (sélecteur de restaurant côté plateforme) : renvoie sa valeur à joindre à la requête. */
  extraFilter?: (p: { tenantId: string; setTenantId: (v: string) => void }) => React.ReactNode;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useUrlParam("canal");
  const [status, setStatus] = useUrlParam("statut");
  const [template, setTemplate] = useUrlParam("modele");
  const [tenantId, setTenantId] = useUrlParam("restaurant");
  const [pageStr, setPage] = useUrlParam("page", "1");
  const page = Math.max(1, Number(pageStr) || 1);
  const [, setParams] = useSearchParams();
  const reset = () => setParams({}, { replace: true });
  const filtered = !!(channel || status || template || tenantId);

  const query: NotificationsQuery = {
    channel: (channel || undefined) as NotificationsQuery["channel"],
    status: (status || undefined) as NotificationsQuery["status"],
    template: template || undefined,
    tenantId: tenantId || undefined,
    page, pageSize: PAGE_SIZE,
  };
  const list = useQuery({ queryKey: [...queryRoot, "notifications", query], queryFn: () => api.list(query), placeholderData: keepPreviousData });

  const resend = useMutation({
    mutationFn: (id: string) => api.resend(id),
    onSuccess: () => { toast.success("Message remis en file d'envoi"); void qc.invalidateQueries({ queryKey: [...queryRoot, "notifications"] }); },
    onError: (e) => toastError(e),
  });

  const ResendButton = ({ n }: { n: NotificationLogItem }) => {
    if (!canResend) return null;
    if (n.status === "QUEUED") return <span className="text-xs text-muted-foreground">En cours…</span>;
    if (!n.canResend) {
      return (
        <Tooltip content="Message confidentiel : il ne peut pas être renvoyé.">
          <span><Button size="sm" variant="ghost" disabled aria-label="Renvoyer (indisponible)"><RotateCw /> Renvoyer</Button></span>
        </Tooltip>
      );
    }
    return (
      <Button size="sm" variant="ghost" loading={resend.isPending && resend.variables === n.id} onClick={(e) => { e.stopPropagation(); resend.mutate(n.id); }}>
        <RotateCw /> Renvoyer
      </Button>
    );
  };

  const columns: Column<NotificationLogItem>[] = [
    { key: "date", header: "Date", cell: (n) => <span className="whitespace-nowrap font-mono text-xs tabular text-muted-foreground">{formatDateTime(n.createdAt)}</span> },
    {
      key: "channel", header: "Canal",
      cell: (n) => <span className="inline-flex items-center gap-1.5 text-[13px]">{n.channel === "EMAIL" ? <Mail className="size-3.5 text-muted-foreground" /> : <MessageSquare className="size-3.5 text-muted-foreground" />}{NOTIFICATION_CHANNEL_LABEL[n.channel]}</span>,
    },
    { key: "to", header: "Destinataire", cell: (n) => <span className="whitespace-nowrap font-mono text-[13px]">{n.to}</span> },
    ...(showTenant ? [{ key: "tenant", header: "Restaurant", hideOnMobile: true, cell: (n: NotificationLogItem) => <span className="block max-w-[160px] truncate text-[13px]">{n.tenant?.name ?? <span className="text-muted-foreground">Plateforme</span>}</span> }] : []),
    {
      key: "message", header: "Message",
      cell: (n) => (
        <div className="flex max-w-[320px] flex-col">
          <span className="truncate text-[13px]">{NOTIFICATION_TEMPLATE_LABEL[n.template] ?? n.template}</span>
          {n.subject && n.channel === "EMAIL" && <span className="truncate text-[11px] text-muted-foreground">{n.subject}</span>}
        </div>
      ),
    },
    {
      key: "status", header: "Statut",
      cell: (n) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={n.status} labels={NOTIFICATION_STATUS_LABEL} />
          {n.status !== "SENT" && n.error && <span className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={n.error}>{n.error}</span>}
        </div>
      ),
    },
    { key: "attempts", header: "Essais", align: "right", hideOnMobile: true, cell: (n) => <span className="font-mono text-xs tabular text-muted-foreground">{n.attempts}</span> },
    { key: "actions", header: <span className="sr-only">Actions</span>, align: "right", cell: (n) => <ResendButton n={n} /> },
  ];

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-end xl:gap-6">
          <Field label="Canal">
            <Segmented ariaLabel="Canal" size="sm" value={channel} onChange={setChannel}
              options={[{ value: "", label: "Tous" }, { value: "EMAIL", label: "Email" }, { value: "SMS", label: "SMS" }]} />
          </Field>
          <Field label="Statut">
            <div className="-mx-1 overflow-x-auto px-1 scrollbar-none">
              <Segmented ariaLabel="Statut" size="sm" value={status} onChange={setStatus} className="w-auto min-w-max"
                options={[{ value: "", label: "Tous" }, { value: "SENT", label: "Envoyés" }, { value: "FAILED", label: "Échecs" }, { value: "QUEUED", label: "En cours" }]} />
            </div>
          </Field>
          <Field label="Type de message">
            <NativeSelect value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Tous les messages</option>
              {Object.entries(NOTIFICATION_TEMPLATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          {extraFilter?.({ tenantId, setTenantId })}
        </div>
        {filtered && (
          <div className="mt-4 flex justify-end border-t border-border pt-4">
            <Button size="sm" variant="ghost" onClick={reset}><X /> Effacer les filtres</Button>
          </div>
        )}
      </Card>

      {list.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10">
          <p className="text-sm">{errorMessage(list.error)}</p>
          <Button size="sm" variant="secondary" onClick={() => list.refetch()}><RefreshCw /> Réessayer</Button>
        </div>
      ) : (
        <DataTable
          caption="Journal des notifications"
          rows={list.data?.items}
          loading={list.isLoading}
          columns={columns}
          rowKey={(n) => n.id}
          mobileCard={(n) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{NOTIFICATION_TEMPLATE_LABEL[n.template] ?? n.template}</span>
                <StatusBadge status={n.status} labels={NOTIFICATION_STATUS_LABEL} />
              </div>
              <p className="truncate font-mono text-[13px]">{n.to}</p>
              {n.status !== "SENT" && n.error && <p className="truncate text-xs text-muted-foreground">{n.error}</p>}
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{NOTIFICATION_CHANNEL_LABEL[n.channel]} · {formatDateTime(n.createdAt)}{showTenant ? ` · ${n.tenant?.name ?? "Plateforme"}` : ""}</span>
                <ResendButton n={n} />
              </div>
            </div>
          )}
          empty={filtered
            ? <EmptyState icon={<SearchX />} title="Aucun message pour ces filtres" action={<Button variant="secondary" onClick={reset}>Effacer les filtres</Button>} />
            : <EmptyState icon={<Bell />} title="Aucun message envoyé" description="Les emails et SMS (relances, réinitialisations de mot de passe…) apparaîtront ici avec leur statut." />}
          footer={list.data && list.data.total > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setPage(String(p))} /> : undefined}
        />
      )}
    </>
  );
}
