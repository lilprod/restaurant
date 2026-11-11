import type { Ingredient, MovementType, StockMovement, WasteRecord } from "@restaurant/api-client";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Archive, ArrowDownUp, ClipboardCheck, History, MoreHorizontal, Package, Pencil, Plus, Search, Trash2, Truck } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input, NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatDateTime, formatFcfa, formatQty } from "@/lib/format";
import { MOVEMENT_TYPE_LABEL, MOVEMENT_TYPES } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useDebounced, useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { AdjustDialog, IngredientDialog, StockStateBadge, WasteDialog, useRefreshStock } from "./stock-dialogs";
import { isPlanFeatureError, useIngredients } from "./stock-hooks";

/** Stock : ingrédients (état, seuil, valeur), mouvements et pertes. Lecture cuisine + responsables, écriture responsables. */
export function StockPage() {
  const t = useTenant();
  const to = useSpacePath();
  const [tab, setTab] = useUrlParam("onglet", "ingredients");
  const [edit, setEdit] = React.useState<{ ingredient: Ingredient | null } | null>(null);
  const [waste, setWaste] = React.useState<{ ingredient: Ingredient | null } | null>(null);
  const [adjust, setAdjust] = React.useState<Ingredient | null>(null);
  const [, setMovIngredient] = useUrlParam("ingredient");

  return (
    <>
      <PageHeader
        title="Stock"
        description="Déduit automatiquement à chaque préparation selon les recettes. Les alertes préviennent avant la rupture."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setWaste({ ingredient: null })}><Trash2 /> Déclarer une perte</Button>
            {t.isManager && <Button variant="secondary" asChild><Link to={to("/stock/inventaire")}><ClipboardCheck /> Inventaire</Link></Button>}
            {t.isManager && <Button variant="primary" onClick={() => setEdit({ ingredient: null })}><Plus /> Ajouter un ingrédient</Button>}
          </div>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v === "ingredients" ? null : v)}>
        <TabsList>
          <TabsTrigger value="ingredients">Ingrédients</TabsTrigger>
          <TabsTrigger value="mouvements">Mouvements</TabsTrigger>
          <TabsTrigger value="pertes">Pertes</TabsTrigger>
        </TabsList>
        <TabsContent value="ingredients" className="pt-5">
          <IngredientsTab onEdit={(i) => setEdit({ ingredient: i })} onWaste={(i) => setWaste({ ingredient: i })} onAdjust={setAdjust}
            onCreate={() => setEdit({ ingredient: null })} onHistory={(i) => { setTab("mouvements"); setMovIngredient(i.id); }} />
        </TabsContent>
        <TabsContent value="mouvements" className="pt-5"><MovementsTab /></TabsContent>
        <TabsContent value="pertes" className="pt-5"><WasteTab /></TabsContent>
      </Tabs>
      {t.isManager && <IngredientDialog value={edit} onClose={() => setEdit(null)} />}
      {t.isManager && <AdjustDialog ingredient={adjust} onClose={() => setAdjust(null)} />}
      <WasteDialog open={!!waste} ingredient={waste?.ingredient} onClose={() => setWaste(null)} />
    </>
  );
}

function PlanGate({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTenant();
  const to = useSpacePath();
  if (isPlanFeatureError(error)) {
    return (
      <Card><EmptyState icon={<Package />} title="Le stock n'est pas inclus dans votre plan"
        description="Recettes, déduction automatique, alertes et fournisseurs sont disponibles à partir du plan Pro."
        action={t.canSeeLicense ? <Button asChild variant="primary"><Link to={to("/licence")}>Voir les plans</Link></Button> : undefined} /></Card>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

function IngredientsTab({ onEdit, onWaste, onAdjust, onCreate, onHistory }: {
  onEdit: (i: Ingredient) => void; onWaste: (i: Ingredient) => void; onAdjust: (i: Ingredient) => void; onCreate: () => void; onHistory: (i: Ingredient) => void;
}) {
  const t = useTenant();
  const to = useSpacePath();
  const confirm = useConfirm();
  const refresh = useRefreshStock();
  const [search, setSearch] = useUrlParam("q");
  const [filter, setFilter] = useUrlParam("etat", "all");
  const [category, setCategory] = useUrlParam("categorie");
  const q = useIngredients({ archived: filter === "archived" ? true : undefined });
  const debounced = useDebounced(search, 150).trim().toLowerCase();
  const all = q.data ?? [];
  const rows = all.filter((i) =>
    (!debounced || i.name.toLowerCase().includes(debounced)) &&
    (!category || i.category === category) &&
    (filter !== "alert" || i.state !== "OK"));
  const categories = [...new Set(all.map((i) => i.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "fr"));
  const alerts = all.filter((i) => i.state !== "OK").length;
  const value = all.reduce((s, i) => s + i.value, 0);

  const archive = useMutation({
    mutationFn: (i: Ingredient) => t.api.inventory.removeIngredient(i.id),
    onSuccess: (r, i) => { void refresh(); toast.success(r.archived ? `« ${i.name} » archivé (historique conservé)` : `« ${i.name} » supprimé`); },
    onError: (e) => toastError(e),
  });
  const restore = useMutation({
    mutationFn: (i: Ingredient) => t.api.inventory.updateIngredient(i.id, { isActive: true }),
    onSuccess: (r) => { void refresh(); toast.success(`« ${r.name} » restauré`); },
    onError: (e) => toastError(e),
  });

  if (q.isError) return <PlanGate error={q.error} onRetry={() => q.refetch()} />;

  const columns: Column<Ingredient>[] = [
    { key: "name", header: "Ingrédient", cell: (i) => (
      <div className="flex flex-col">
        <span className="font-medium">{i.name}</span>
        <span className="text-[12.5px] text-muted-foreground">{i.category ?? "Sans catégorie"}{i.autoDisable && " · désactive les plats à zéro"}</span>
      </div>
    ) },
    { key: "state", header: "État", cell: (i) => <StockStateBadge state={i.state} /> },
    { key: "qty", header: "Stock", align: "right", cell: (i) => (
      <div className="flex flex-col items-end">
        <span className={cn("font-mono tabular-nums", i.quantity < 0 && "text-danger")}>{formatQty(i.quantity, i.unit)}</span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">seuil {formatQty(i.lowStockThreshold, i.unit)}</span>
      </div>
    ) },
    ...(t.isManager ? [
      { key: "cost", header: "Coût moyen", align: "right" as const, hideOnMobile: true, cell: (i: Ingredient) => <span className="font-mono tabular-nums">{formatFcfa(i.avgCost)}</span> },
      { key: "value", header: "Valeur", align: "right" as const, cell: (i: Ingredient) => <span className="font-mono tabular-nums">{formatFcfa(i.value)}</span> },
    ] : []),
    { key: "supplier", header: "Fournisseur", hideOnMobile: true, cell: (i) => <span className="text-muted-foreground">{i.supplier?.name ?? "—"}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      {t.isManager && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card className="flex flex-col gap-1 p-4"><span className="text-[12px] uppercase tracking-wide text-muted-foreground">Valeur du stock</span><span className="font-mono text-xl font-semibold tabular-nums">{q.isLoading ? "…" : formatFcfa(value)}</span></Card>
          <Card className="flex flex-col gap-1 p-4"><span className="text-[12px] uppercase tracking-wide text-muted-foreground">Ingrédients suivis</span><span className="font-mono text-xl font-semibold tabular-nums">{q.isLoading ? "…" : all.length}</span></Card>
          <Card className="col-span-2 flex flex-col gap-1 p-4 sm:col-span-1">
            <span className="text-[12px] uppercase tracking-wide text-muted-foreground">À surveiller</span>
            <span className={cn("font-mono text-xl font-semibold tabular-nums", alerts > 0 && "text-[var(--tone-amber-fg)]")}>{q.isLoading ? "…" : alerts}</span>
          </Card>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input className="sm:max-w-xs" leading={<Search className="size-4" />} placeholder="Rechercher un ingrédient" aria-label="Rechercher un ingrédient" value={search} onChange={(e) => setSearch(e.target.value || null)} />
        <Segmented ariaLabel="Filtrer" size="sm" value={filter as "all" | "alert" | "archived"} onChange={(v) => setFilter(v === "all" ? null : v)}
          options={[{ value: "all", label: "Tous" }, { value: "alert", label: `Alertes${alerts ? ` (${alerts})` : ""}` }, ...(t.isManager ? [{ value: "archived" as const, label: "Archivés" }] : [])]} />
        {categories.length > 0 && (
          <div className="sm:w-56"><NativeSelect aria-label="Catégorie" value={category} onChange={(e) => setCategory(e.target.value || null)}>
            <option value="">Toutes les catégories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </NativeSelect></div>
        )}
      </div>
      <DataTable
        rows={q.data ? rows : undefined}
        loading={q.isLoading}
        columns={columns}
        rowKey={(i) => i.id}
        caption="Ingrédients"
        onRowClick={t.isManager && filter !== "archived" ? onEdit : undefined}
        empty={all.length === 0 && filter !== "archived" ? (
          <EmptyState icon={<Package />} title="Aucun ingrédient" description="Ajoutez vos ingrédients, puis la recette de chaque plat : le stock se déduira tout seul à chaque préparation."
            action={t.isManager ? <Button variant="primary" onClick={onCreate}><Plus /> Ajouter un ingrédient</Button> : undefined} />
        ) : <EmptyState icon={<Search />} title="Aucun résultat" description="Modifiez la recherche ou les filtres." />}
        rowActions={(i) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions pour ${i.name}`} onClick={(e) => e.stopPropagation()}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {filter === "archived" ? (
                <DropdownMenuItem onSelect={() => restore.mutate(i)}><Archive /> Restaurer</DropdownMenuItem>
              ) : (
                <>
                  {t.isManager && <DropdownMenuItem onSelect={() => onEdit(i)}><Pencil /> Modifier</DropdownMenuItem>}
                  {t.isManager && <DropdownMenuItem onSelect={() => onAdjust(i)}><ArrowDownUp /> Corriger le stock</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => onWaste(i)}><Trash2 /> Déclarer une perte</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onHistory(i)}><History /> Voir les mouvements</DropdownMenuItem>
                  {t.isManager && i.supplier && <DropdownMenuItem asChild><Link to={to(`/fournisseurs?nouvelle=${i.id}`)}><Truck /> Commander</Link></DropdownMenuItem>}
                  {t.isManager && <DropdownMenuSeparator />}
                  {t.isManager && (
                    <DropdownMenuItem destructive onSelect={() => confirm({
                      title: `Archiver « ${i.name} » ?`,
                      description: "Il disparaît des listes ; ses mouvements restent dans l'historique. Un ingrédient encore utilisé dans une recette ne peut pas être archivé.",
                      confirmLabel: "Archiver", onConfirm: () => archive.mutateAsync(i),
                    })}><Archive /> Archiver</DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />
    </div>
  );
}

const PAGE = 50;

function signed(q: number, unit: string) {
  return `${q > 0 ? "+" : ""}${formatQty(q, unit)}`;
}

function MovementsTab() {
  const t = useTenant();
  const [type, setType] = useUrlParam("type");
  const [ingredientId, setIngredientId] = useUrlParam("ingredient");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [type, ingredientId]);
  const ingredients = useIngredients();
  const query = { type: (type || undefined) as MovementType | undefined, ingredientId: ingredientId || undefined, page, pageSize: PAGE };
  const q = useQuery({ queryKey: tenantKeys.movements(t.root, query), queryFn: () => t.api.inventory.movements(query), placeholderData: keepPreviousData });
  if (q.isError) return <PlanGate error={q.error} onRetry={() => q.refetch()} />;
  const columns: Column<StockMovement>[] = [
    { key: "date", header: "Date", cell: (m) => <span className="font-mono text-[13px] tabular-nums">{formatDateTime(m.createdAt)}</span> },
    { key: "ingredient", header: "Ingrédient", cell: (m) => <span className="font-medium">{m.ingredient.name}</span> },
    { key: "type", header: "Type", cell: (m) => <Badge tone={m.quantity < 0 ? (m.type === "WASTE" ? "red" : "gray") : "green"}>{MOVEMENT_TYPE_LABEL[m.type]}</Badge> },
    { key: "qty", header: "Quantité", align: "right", cell: (m) => <span className={cn("font-mono tabular-nums", m.quantity > 0 && "text-[var(--tone-green-fg)]")}>{signed(m.quantity, m.ingredient.unit)}</span> },
    { key: "balance", header: "Solde", align: "right", cell: (m) => <span className="font-mono tabular-nums text-muted-foreground">{formatQty(m.balanceAfter, m.ingredient.unit)}</span> },
    ...(t.isManager ? [{ key: "value", header: "Valeur", align: "right" as const, hideOnMobile: true, cell: (m: StockMovement) => <span className="font-mono tabular-nums">{m.value === null ? "—" : formatFcfa(m.value)}</span> }] : []),
    { key: "reason", header: "Motif", hideOnMobile: true, className: "max-w-[280px] truncate", cell: (m) => <span className="text-muted-foreground" title={m.reason ?? undefined}>{m.reason ?? "—"}{m.user && ` · ${m.user.firstName}`}</span> },
  ];
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / PAGE)) : 1;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-64"><NativeSelect aria-label="Ingrédient" value={ingredientId} onChange={(e) => setIngredientId(e.target.value || null)}>
          <option value="">Tous les ingrédients</option>
          {ingredients.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </NativeSelect></div>
        <div className="sm:w-56"><NativeSelect aria-label="Type de mouvement" value={type} onChange={(e) => setType(e.target.value || null)}>
          <option value="">Tous les types</option>
          {MOVEMENT_TYPES.map((m) => <option key={m} value={m}>{MOVEMENT_TYPE_LABEL[m]}</option>)}
        </NativeSelect></div>
      </div>
      <DataTable rows={q.data?.items} loading={q.isLoading} columns={columns} rowKey={(m) => m.id} caption="Mouvements de stock"
        empty={<EmptyState icon={<History />} title="Aucun mouvement" description="Préparations, réceptions, pertes et inventaires apparaissent ici." />}
        footer={pages > 1 ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted-foreground">
            <span>Page {page} sur {pages} · {q.data?.total} mouvements</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          </div>
        ) : undefined} />
    </div>
  );
}

function WasteTab() {
  const t = useTenant();
  const q = useQuery({ queryKey: tenantKeys.waste(t.root, {}), queryFn: () => t.api.inventory.waste({ pageSize: 100 }) });
  if (q.isError) return <PlanGate error={q.error} onRetry={() => q.refetch()} />;
  const columns: Column<WasteRecord>[] = [
    { key: "date", header: "Date", cell: (w) => <span className="font-mono text-[13px] tabular-nums">{formatDateTime(w.createdAt)}</span> },
    { key: "ingredient", header: "Ingrédient", cell: (w) => <span className="font-medium">{w.ingredient.name}</span> },
    { key: "qty", header: "Quantité", align: "right", cell: (w) => <span className="font-mono tabular-nums">{formatQty(w.quantity, w.ingredient.unit)}</span> },
    ...(t.isManager ? [{ key: "cost", header: "Coût", align: "right" as const, cell: (w: WasteRecord) => <span className="font-mono tabular-nums">{formatFcfa(w.cost)}</span> }] : []),
    { key: "reason", header: "Motif", className: "max-w-[320px] truncate", cell: (w) => (
      <span className="flex items-center gap-2">{w.automatic && <Badge tone="gray">Annulation</Badge>}<span className="truncate text-muted-foreground" title={w.reason}>{w.reason}</span></span>
    ) },
    { key: "by", header: "Par", hideOnMobile: true, cell: (w) => <span className="text-muted-foreground">{w.recordedBy ? `${w.recordedBy.firstName} ${w.recordedBy.lastName}` : "—"}</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      {t.isManager && q.data && (
        <p className="text-sm text-muted-foreground">Total des pertes : <span className="font-mono font-medium text-foreground">{formatFcfa(q.data.totalCost)}</span> sur {q.data.total} déclaration{q.data.total > 1 ? "s" : ""}.</p>
      )}
      <DataTable rows={q.data?.items} loading={q.isLoading} columns={columns} rowKey={(w) => w.id} caption="Pertes"
        empty={<EmptyState icon={<Trash2 />} title="Aucune perte déclarée" description="Les produits abîmés et les plats annulés après lancement apparaissent ici." />} />
    </div>
  );
}
