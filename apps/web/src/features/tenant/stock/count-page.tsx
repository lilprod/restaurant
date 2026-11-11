import type { StockCount, StockCountLine } from "@restaurant/api-client";
import { stockCountTone } from "@restaurant/ui-tokens";
import { roundQty } from "@restaurant/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ClipboardCheck, Save } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDateTime, formatFcfa, formatQty } from "@/lib/format";
import { STOCK_COUNT_STATUS_LABEL, STOCK_UNIT_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { useRefreshStock } from "./stock-dialogs";
import { parseQty, useIngredients } from "./stock-hooks";

/** Inventaire physique (responsables, sur tablette) : saisie des quantités comptées → ajustements valorisés. */
export function StockCountPage() {
  const t = useTenant();
  const to = useSpacePath();
  const [id, setId] = useUrlParam("id");
  const counts = useQuery({ queryKey: tenantKeys.counts(t.root), queryFn: () => t.api.inventory.counts() });
  const open = counts.data?.find((c) => c.status === "OPEN");
  const current = id || open?.id || "";

  return (
    <>
      <PageHeader
        eyebrow={<Link to={to("/stock")} className="inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="size-3.5" /> Stock</Link>}
        title="Inventaire"
        description="Comptez ce qui est réellement en réserve : les écarts deviennent des ajustements valorisés au coût moyen."
      />
      {counts.isError ? <ErrorState error={counts.error} onRetry={() => counts.refetch()} /> : counts.isLoading ? <Skeleton className="h-64" /> : current ? (
        <CountSheet id={current} onBack={() => setId(null)} />
      ) : (
        <div className="flex flex-col gap-6">
          <StartCount onStarted={(c) => setId(c.id)} />
          <section className="flex flex-col gap-3">
            <h2 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Inventaires précédents</h2>
            <DataTable rows={counts.data} rowKey={(c) => c.id} onRowClick={(c) => setId(c.id)} caption="Inventaires"
              columns={[
                { key: "date", header: "Date", cell: (c) => <span className="font-mono text-[13px] tabular-nums">{formatDateTime(c.validatedAt ?? c.createdAt)}</span> },
                { key: "status", header: "État", cell: (c) => <Badge tone={stockCountTone(c.status)} dot>{STOCK_COUNT_STATUS_LABEL[c.status]}</Badge> },
                { key: "scope", header: "Périmètre", cell: (c) => <span className="text-muted-foreground">{c.category ?? "Tout le stock"} · {c.countedCount}/{c.lineCount} comptés</span> },
                { key: "variance", header: "Écart valorisé", align: "right", cell: (c) => <Variance value={c.varianceCost} /> },
              ]}
              empty={<EmptyState icon={<ClipboardCheck />} title="Aucun inventaire" description="Faites un premier inventaire pour partir d'un stock juste." />} />
          </section>
        </div>
      )}
    </>
  );
}

function Variance({ value }: { value: number }) {
  return <span className={cn("font-mono tabular-nums", value < 0 && "text-danger", value > 0 && "text-[var(--tone-green-fg)]")}>{value > 0 ? "+" : ""}{formatFcfa(value)}</span>;
}

function StartCount({ onStarted }: { onStarted: (c: StockCount) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const ingredients = useIngredients();
  const [category, setCategory] = React.useState("");
  const categories = [...new Set((ingredients.data ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr"));
  const start = useMutation({
    mutationFn: () => t.api.inventory.createCount({ category: category || undefined }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: tenantKeys.counts(t.root) }); onStarted(c); },
    onError: (e) => toastError(e),
  });
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:p-6">
      <div className="flex flex-1 flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight">Commencer un inventaire</h2>
        <p className="text-[13px] text-muted-foreground">Tout le stock ou une seule catégorie (ex. la chambre froide). Vous pouvez enregistrer la saisie et la reprendre plus tard.</p>
      </div>
      <Field label="Périmètre" className="sm:w-56">
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Tout le stock</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
      </Field>
      <Button variant="primary" size="lg" loading={start.isPending} onClick={() => start.mutate()}><ClipboardCheck /> Commencer</Button>
    </Card>
  );
}

function CountSheet({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refresh = useRefreshStock();
  const q = useQuery({ queryKey: tenantKeys.count(t.root, id), queryFn: () => t.api.inventory.count(id) });
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(q.data.lines.map((l) => [l.ingredient.id, l.countedQty == null ? "" : String(l.countedQty).replace(".", ",")])));
  }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const after = (c: StockCount) => {
    qc.setQueryData(tenantKeys.count(t.root, id), c);
    void qc.invalidateQueries({ queryKey: tenantKeys.counts(t.root) });
  };
  const dirtyLines = () => (q.data?.lines ?? []).flatMap((l) => {
    const v = parseQty(draft[l.ingredient.id] ?? "");
    return v !== l.countedQty && (v === null || v >= 0) ? [{ ingredientId: l.ingredient.id, countedQty: v === null ? null : roundQty(v) }] : [];
  });
  const save = useMutation({
    mutationFn: async () => { const lines = dirtyLines(); return lines.length ? t.api.inventory.saveCount(id, lines) : q.data!; },
    onSuccess: (c) => { after(c); toast.success("Saisie enregistrée"); },
    onError: (e) => toastError(e),
  });
  const validate = useMutation({
    mutationFn: async () => { const lines = dirtyLines(); if (lines.length) await t.api.inventory.saveCount(id, lines); return t.api.inventory.validateCount(id); },
    onSuccess: (c) => { after(c); void refresh(); toast.success(`Inventaire validé : écart ${formatFcfa(c.varianceCost)}`); },
  });
  const cancel = useMutation({ mutationFn: () => t.api.inventory.cancelCount(id), onSuccess: (c) => { after(c); onBack(); toast.success("Inventaire annulé"); } });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const c = q.data;
  const editable = c.status === "OPEN" && t.isManager;
  const countedNow = c.lines.filter((l) => parseQty(draft[l.ingredient.id] ?? "") !== null).length;
  const variance = c.status === "VALIDATED" ? c.varianceCost : c.lines.reduce((s, l) => {
    const v = parseQty(draft[l.ingredient.id] ?? "");
    return v === null ? s : s + Math.round((v - l.expectedQty) * l.unitCost);
  }, 0);
  const groups = groupBy(c.lines, (l) => l.ingredient.category ?? "Sans catégorie");

  if (!editable) {
    const columns: Column<StockCountLine>[] = [
      { key: "name", header: "Ingrédient", cell: (l) => <span className="font-medium">{l.ingredient.name}</span> },
      { key: "expected", header: "Théorique", align: "right", cell: (l) => <span className="font-mono tabular-nums">{formatQty(l.expectedQty, l.ingredient.unit)}</span> },
      { key: "counted", header: "Compté", align: "right", cell: (l) => <span className="font-mono tabular-nums">{l.countedQty === null ? "—" : formatQty(l.countedQty, l.ingredient.unit)}</span> },
      { key: "variance", header: "Écart", align: "right", cell: (l) => l.varianceCost === null ? <span className="text-muted-foreground">—</span> : <Variance value={l.varianceCost} /> },
    ];
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={onBack}><ArrowLeft /> Tous les inventaires</Button>
          <Badge tone={stockCountTone(c.status)} dot>{STOCK_COUNT_STATUS_LABEL[c.status]}</Badge>
          <span className="text-sm text-muted-foreground">{formatDateTime(c.validatedAt ?? c.createdAt)} · {c.category ?? "Tout le stock"}</span>
          <span className="ml-auto text-sm">Écart total : <Variance value={c.varianceCost} /></span>
        </div>
        <DataTable rows={c.lines} rowKey={(l) => l.ingredient.id} columns={columns} caption="Lignes de l'inventaire" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {validate.error && <ErrorState compact error={new Error(errorMessage(validate.error))} />}
      {groups.map(([category, lines]) => (
        <section key={category} className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{category}</h2>
          <Card className="divide-y divide-border">
            {lines.map((l) => {
              const raw = draft[l.ingredient.id] ?? "";
              const v = parseQty(raw);
              const diff = v === null ? null : roundQty(v - l.expectedQty);
              return (
                <label key={l.ingredient.id} className="flex items-center gap-3 px-4 py-3 sm:gap-4">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-medium">{l.ingredient.name}</span>
                    <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">
                      théorique {formatQty(l.expectedQty, l.ingredient.unit)}
                      {diff !== null && diff !== 0 && <span className={cn("ml-2", diff < 0 ? "text-danger" : "text-[var(--tone-green-fg)]")}>{diff > 0 ? "+" : ""}{formatQty(diff, l.ingredient.unit)}</span>}
                    </span>
                  </span>
                  <span className="w-32 shrink-0 sm:w-36">
                  <Input inputMode="decimal" aria-label={`Quantité comptée : ${l.ingredient.name}`} placeholder="—" value={raw}
                    aria-invalid={raw !== "" && (v === null || v < 0)}
                    onChange={(e) => setDraft((d) => ({ ...d, [l.ingredient.id]: e.target.value }))}
                    className="h-14 pr-14 text-right font-mono text-lg tabular-nums sm:h-12"
                    trailing={<span className="pr-2 text-sm text-muted-foreground">{STOCK_UNIT_LABEL[l.ingredient.unit]}</span>} />
                  </span>
                  <Check aria-hidden className={cn("size-5 shrink-0 text-[var(--tone-green-fg)]", v === null && "invisible")} />
                </label>
              );
            })}
          </Card>
        </section>
      ))}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm"><span className="font-mono tabular-nums">{countedNow}/{c.lines.length}</span> comptés · écart estimé <Variance value={variance} /></span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => confirm({ title: "Annuler cet inventaire ?", description: "La saisie est abandonnée ; le stock ne change pas.", confirmLabel: "Annuler l'inventaire", onConfirm: () => cancel.mutateAsync() })}>Annuler</Button>
            <Button variant="secondary" size="lg" loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>
            <Button variant="primary" size="lg" disabled={countedNow === 0} loading={validate.isPending} onClick={() => confirm({
              title: "Valider l'inventaire ?", tone: "primary",
              description: `${countedNow} ingrédient${countedNow > 1 ? "s" : ""} compté${countedNow > 1 ? "s" : ""} : le stock est remplacé par les quantités saisies (écart calculé au moment de la validation). Les lignes vides ne changent pas.`,
              confirmLabel: "Valider l'inventaire", onConfirm: () => validate.mutateAsync(),
            })}><ClipboardCheck /> Valider</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function groupBy<T>(rows: T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()];
}
