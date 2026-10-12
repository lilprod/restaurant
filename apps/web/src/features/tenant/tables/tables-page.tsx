import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, type DiningTable } from "@restaurant/api-client";
import { tableStatusTone } from "@restaurant/ui-tokens";
import { tableInputSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brush, CheckCircle2, ClipboardList, EyeOff, LayoutGrid, MoreHorizontal, Pencil, Plus, SquarePlus, Trash2, Users,
} from "lucide-react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge, StatusBadge, toneDotClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { SwitchRow } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { TABLE_STATUS_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { elapsedLabel, useNow, useTenant } from "../hooks";
import { OrderStatusBadge } from "../orders/order-bits";

/** Tables du restaurant (cache partagé, mis à jour par le temps réel). Les responsables voient aussi les tables désactivées. */
export function useTables() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.tables(t.root), queryFn: () => t.api.tables.list({ all: t.isManager }), refetchInterval: 120_000 });
}

type Filter = "all" | "FREE" | "OCCUPIED" | "CLEANING";

export function TablesPage() {
  const t = useTenant();
  const tables = useTables();
  const [filter, setFilter] = useUrlParam("statut", "all");
  const [edit, setEdit] = React.useState<DiningTable | "new" | null>(null);
  const [showInactive, setShowInactive] = React.useState(false);
  const now = useNow(30_000);

  const active = (tables.data ?? []).filter((x) => x.isActive);
  const inactive = (tables.data ?? []).filter((x) => !x.isActive);
  const count = (s: string) => active.filter((x) => x.status === s).length;
  const shown = filter === "all" ? active : active.filter((x) => x.status === filter);

  return (
    <>
      <PageHeader
        title="Tables"
        description="La salle en direct. Touchez une table pour ouvrir sa commande ou en créer une."
        actions={t.isManager && <Button variant="primary" onClick={() => setEdit("new")}><Plus /> Ajouter une table</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<Filter>
          ariaLabel="Filtrer les tables"
          value={filter as Filter}
          onChange={(v) => setFilter(v)}
          size="sm"
          options={[
            { value: "all", label: <>Toutes <Count n={active.length} /></> },
            { value: "FREE", label: <>Libres <Count n={count("FREE")} /></> },
            { value: "OCCUPIED", label: <>Occupées <Count n={count("OCCUPIED")} /></> },
            { value: "CLEANING", label: <>À débarrasser <Count n={count("CLEANING")} /></> },
          ]}
        />
        {t.isManager && inactive.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowInactive((v) => !v)}><EyeOff /> {showInactive ? "Masquer" : "Afficher"} les tables désactivées ({inactive.length})</Button>
        )}
      </div>

      {tables.isError ? <ErrorState error={tables.error} onRetry={() => tables.refetch()} /> : tables.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}</div>
      ) : active.length === 0 ? (
        <Card><EmptyState icon={<LayoutGrid />} title="Aucune table" description="Ajoutez les tables de votre salle pour prendre les commandes sur place."
          action={t.isManager ? <Button variant="primary" onClick={() => setEdit("new")}><Plus /> Ajouter une table</Button> : undefined} /></Card>
      ) : shown.length === 0 ? (
        <Card><EmptyState icon={<CheckCircle2 />} title="Aucune table dans cet état" description="Changez de filtre pour voir les autres tables." /></Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((table) => <li key={table.id}><TableCard table={table} now={now} onEdit={() => setEdit(table)} /></li>)}
        </ul>
      )}

      {showInactive && inactive.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tables désactivées</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {inactive.map((table) => <li key={table.id}><TableCard table={table} now={now} onEdit={() => setEdit(table)} /></li>)}
          </ul>
        </section>
      )}

      <TableDialog value={edit} onClose={() => setEdit(null)} />
    </>
  );
}

const Count = ({ n }: { n: number }) => <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{n}</span>;

/** Carte d'une table : statut (couleur + texte), commande ouverte (numéro, total, temps écoulé), actions. */
export function TableCard({ table, now, onEdit, compact }: { table: DiningTable; now: number; onEdit?: () => void; compact?: boolean }) {
  const t = useTenant();
  const to = useSpacePath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [pick, setPick] = React.useState(false);
  const order = table.openOrders[0];
  const tone = tableStatusTone(table.status);

  const setStatus = useMutation({
    mutationFn: (status: "FREE" | "CLEANING") => t.api.tables.setStatus(table.id, status),
    onSuccess: (_r, status) => {
      qc.setQueryData<DiningTable[]>(tenantKeys.tables(t.root), (rows) => rows?.map((r) => (r.id === table.id ? { ...r, status } : r)));
      toast.success(status === "FREE" ? `Table ${table.label} libre` : `Table ${table.label} à débarrasser`);
    },
    onError: (e) => toastError(e),
  });
  const remove = useMutation({
    mutationFn: () => t.api.tables.remove(table.id),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) }); toast.success(r.archived ? `Table ${table.label} désactivée (historique conservé)` : `Table ${table.label} supprimée`); },
    onError: (e) => toastError(e),
  });
  const reactivate = useMutation({
    mutationFn: () => t.api.tables.update(table.id, { isActive: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) }); toast.success(`Table ${table.label} réactivée`); },
    onError: (e) => toastError(e),
  });

  const newOrder = () => navigate(to(`/commandes/nouvelle?table=${table.id}`));
  const open = () => {
    if (!table.isActive) return onEdit?.();
    if (table.openOrders.length === 1) navigate(to(`/commandes/${order!.id}`));
    else if (table.openOrders.length > 1) setPick(true);
    else if (t.isFloor) newOrder();
  };

  return (
    <>
      <Card className={cn("group relative flex h-full flex-col overflow-hidden transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-md", !table.isActive && "opacity-60")}>
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", toneDotClass[tone])} />
        <button
          type="button"
          onClick={open}
          className={cn("flex flex-1 flex-col gap-3 p-4 pt-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", compact ? "min-h-[112px]" : "min-h-[148px]")}
          aria-label={`Table ${table.label}, ${TABLE_STATUS_LABEL[table.status]}${order ? `, commande n°${order.number}` : ""}`}
        >
          <div className="flex items-start justify-between gap-2 pr-8">
            <span className="truncate text-2xl font-semibold tracking-tight">{table.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {table.isActive ? <StatusBadge status={table.status} labels={TABLE_STATUS_LABEL} toneOf={tableStatusTone} /> : <Badge tone="outline">Désactivée</Badge>}
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" aria-hidden />{table.capacity}<span className="sr-only"> places</span></span>
          </div>
          {order ? (
            <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">n°{order.number}{table.openOrders.length > 1 && <span className="text-muted-foreground"> +{table.openOrders.length - 1}</span>}</span>
                <span className="font-mono text-muted-foreground tabular-nums">{elapsedLabel(order.createdAt, now)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <OrderStatusBadge status={order.status} className="h-5 text-[11px]" />
                <span className="whitespace-nowrap font-mono font-medium tabular-nums">{formatFcfa(order.total)}</span>
              </div>
            </div>
          ) : table.isActive && !compact && (
            <span className="mt-auto inline-flex items-center gap-1.5 text-[13px] text-muted-foreground group-hover:text-foreground">
              {table.status === "CLEANING" ? <><Brush className="size-3.5" /> À débarrasser</> : t.isFloor ? <><SquarePlus className="size-3.5" /> Nouvelle commande</> : null}
            </span>
          )}
        </button>
        {(t.isFloor || t.isManager) && (
          <div className="absolute right-1.5 top-2.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions pour la table ${table.label}`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {table.isActive && t.isFloor && <DropdownMenuItem onSelect={newOrder}><SquarePlus /> Nouvelle commande</DropdownMenuItem>}
                {table.openOrders.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => navigate(to(`/commandes/${o.id}`))}><ClipboardList /> Commande n°{o.number}</DropdownMenuItem>
                ))}
                {table.isActive && t.isFloor && !table.openOrders.length && (
                  table.status === "CLEANING"
                    ? <DropdownMenuItem onSelect={() => setStatus.mutate("FREE")}><CheckCircle2 /> Marquer libre</DropdownMenuItem>
                    : <DropdownMenuItem onSelect={() => setStatus.mutate("CLEANING")}><Brush /> Marquer à débarrasser</DropdownMenuItem>
                )}
                {t.isManager && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onEdit?.()}><Pencil /> Modifier</DropdownMenuItem>
                    {table.isActive ? (
                      <DropdownMenuItem destructive disabled={table.openOrders.length > 0} onSelect={() => confirm({
                        title: `Retirer la table ${table.label} ?`,
                        description: "Une table qui n'a jamais servi est supprimée. Si elle a déjà eu des commandes, elle est seulement désactivée : l'historique reste consultable.",
                        confirmLabel: "Retirer la table",
                        onConfirm: () => remove.mutateAsync(),
                      })}><Trash2 /> Retirer la table</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => reactivate.mutate()}><CheckCircle2 /> Réactiver</DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {table.status === "CLEANING" && table.isActive && t.isFloor && !compact && (
          <div className="border-t border-border p-2">
            <Button variant="secondary" size="sm" className="w-full" loading={setStatus.isPending} onClick={() => setStatus.mutate("FREE")}><CheckCircle2 /> Marquer libre</Button>
          </div>
        )}
      </Card>
      <Dialog open={pick} onOpenChange={setPick} size="sm" title={`Table ${table.label}`} description="Plusieurs commandes sont ouvertes sur cette table.">
        <ul className="flex flex-col gap-2">
          {table.openOrders.map((o) => (
            <li key={o.id}>
              <Link to={to(`/commandes/${o.id}`)} className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:bg-hover">
                <span className="font-medium">Commande n°{o.number}</span>
                <span className="flex items-center gap-2"><OrderStatusBadge status={o.status} /><span className="font-mono text-sm tabular-nums">{formatFcfa(o.total)}</span></span>
              </Link>
            </li>
          ))}
          <li><Button variant="secondary" className="w-full" onClick={newOrder}><SquarePlus /> Nouvelle commande</Button></li>
        </ul>
      </Dialog>
    </>
  );
}

type TableForm = z.input<typeof tableInputSchema>;

function TableDialog({ value, onClose }: { value: DiningTable | "new" | null; onClose: () => void }) {
  const t = useTenant();
  const to = useSpacePath();
  const qc = useQueryClient();
  const editing = value && value !== "new" ? value : null;
  const [limit, setLimit] = React.useState<string | null>(null);
  const form = useForm<TableForm>({ resolver: zodResolver(tableInputSchema), defaultValues: { label: "", capacity: 4, isActive: true } });
  React.useEffect(() => {
    if (!value) return;
    setLimit(null);
    form.reset(editing ? { label: editing.label, capacity: editing.capacity, isActive: editing.isActive } : { label: "", capacity: 4, isActive: true });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (v: TableForm) => {
      const body = { label: v.label.trim(), capacity: v.capacity, isActive: v.isActive ?? true };
      return editing ? t.api.tables.update(editing.id, body) : t.api.tables.create(body);
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) });
      toast.success(editing ? `Table ${r.label} enregistrée` : `Table ${r.label} ajoutée`);
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isPlanLimit) { setLimit(e.message); return; }
      if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) });
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} size="sm"
      title={editing ? `Modifier la table ${editing.label}` : "Ajouter une table"}
      description="Le nom apparaît sur les commandes, l'écran cuisine et les tickets."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{editing ? "Enregistrer" : "Ajouter la table"}</Button></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {limit && (
          <Callout tone="warning" title="Limite de votre plan atteinte" action={t.canSeeLicense ? <Button asChild size="sm" variant="secondary"><Link to={to("/licence")}>Voir les plans</Link></Button> : undefined}>{limit}</Callout>
        )}
        {form.formState.errors.root && <Callout tone="danger">{form.formState.errors.root.message}</Callout>}
        <Field label="Nom de la table" required error={form.formState.errors.label?.message} hint="Ex. T5, Terrasse 2, Bar.">
          <Input autoFocus maxLength={20} {...form.register("label")} className="font-mono" />
        </Field>
        <Field label="Nombre de places">
          <Controller control={form.control} name="capacity" render={({ field }) => (
            <Stepper label="places" value={field.value} min={1} max={50} onChange={(v) => field.onChange(Math.max(1, Math.min(50, v)))} />
          )} />
        </Field>
        {editing && (
          <Controller control={form.control} name="isActive" render={({ field }) => (
            <SwitchRow label="Table active" description="Une table désactivée n'apparaît plus en salle ni dans la prise de commande." checked={!!field.value} onCheckedChange={field.onChange} />
          )} />
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
