import type { DiningTable, FloorPlan, TableLayoutEntry, TableShape } from "@restaurant/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, MoreHorizontal, Pencil, Plus, RotateCcw, RotateCw, Save, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { useAllTables } from "../tables/tables-page";
import {
  DEFAULT_SIZE, GRID, MAX_SIZE, MIN_SIZE, clamp, fitScale, freeSpot, layoutOf, nextLabel, overlappingIds, planTables, reshape, rotate, sameLayout, snapPosition,
} from "./floor-geometry";
import { useFloorPlans } from "./floor-hooks";
import { TileFrame } from "./table-tile";

const SHAPES: { value: TableShape; label: string }[] = [{ value: "round", label: "Rond" }, { value: "square", label: "Carré" }, { value: "rect", label: "Rectangle" }];
const SHAPE_LABEL: Record<TableShape, string> = { round: "ronde", square: "carrée", rect: "rectangulaire" };

type Draft = Record<string, TableLayoutEntry>;

/** Éditeur du plan (responsables) : glisser-déposer sur grille aimantée, formes, rotation, duplication, zoom, salles ; enregistrement explicite. */
export function FloorEditorPage() {
  const t = useTenant();
  const to = useSpacePath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const plans = useFloorPlans();
  const tables = useAllTables();
  const [planParam, setPlanParam] = useUrlParam("salle", "");
  const [draft, setDraft] = React.useState<Draft>({});
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState<number | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [planDialog, setPlanDialog] = React.useState<"new" | "edit" | null>(null);

  const planList = plans.data ?? [];
  const plan = planList.find((p) => p.id === planParam) ?? planList[0];
  const all = tables.data ?? [];
  const mine = plan ? planTables(all, plan.id) : [];
  const serverById = new Map(all.map((x) => [x.id, x]));
  const geoOf = (x: DiningTable): TableLayoutEntry => draft[x.id] ?? layoutOf(x);
  const entries = mine.map(geoOf);
  const overlapping = React.useMemo(() => overlappingIds(entries), [entries.map((e) => `${e.id}:${e.posX},${e.posY},${e.width},${e.height}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirtyIds = Object.keys(draft);
  const dirty = dirtyIds.length > 0;
  const selected = selectedId ? serverById.get(selectedId) : undefined;

  /** Applique une modification à une table : bornée à la salle et aimantée ; une table revenue à son état enregistré quitte le brouillon. */
  const update = React.useCallback((id: string, fn: (e: TableLayoutEntry) => TableLayoutEntry) => {
    const server = serverById.get(id);
    const p = server && planList.find((x) => x.id === server.floorPlanId);
    if (!server || !p) return;
    setDraft((d) => {
      let next = fn(d[id] ?? layoutOf(server));
      next = { ...next, width: clamp(next.width, MIN_SIZE, MAX_SIZE), height: clamp(next.height, MIN_SIZE, MAX_SIZE) };
      next = { ...next, ...snapPosition(next.posX, next.posY, next, p) };
      const rest = { ...d };
      if (sameLayout(next, layoutOf(server))) delete rest[id]; else rest[id] = next;
      return rest;
    });
  }, [serverById, planList]);

  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const byPlan = new Map<string, TableLayoutEntry[]>();
      for (const id of dirtyIds) {
        const s = serverById.get(id);
        if (s) byPlan.set(s.floorPlanId, [...(byPlan.get(s.floorPlanId) ?? []), draft[id]!]);
      }
      const saved: DiningTable[] = [];
      for (const [planId, list] of byPlan) saved.push(...await t.api.floorPlans.saveLayout(planId, list));
      return saved;
    },
    onSuccess: (saved) => {
      qc.setQueryData<DiningTable[]>(tenantKeys.tables(t.root), (rows) => rows?.map((r) => saved.find((s) => s.id === r.id) ?? r));
      setDraft({});
      toast.success("Plan enregistré");
    },
    onError: (e) => toastError(e),
  });

  const discard = () => confirm({
    title: "Annuler les modifications ?", description: `${dirtyIds.length} table${dirtyIds.length > 1 ? "s" : ""} retrouvent leur dernière position enregistrée.`,
    confirmLabel: "Annuler les modifications", onConfirm: () => setDraft({}),
  });
  const leave = () => {
    if (!dirty) return navigate(to("/plan-de-salle"));
    confirm({ title: "Quitter sans enregistrer ?", description: "Les modifications du plan seront perdues.", confirmLabel: "Quitter", onConfirm: () => navigate(to("/plan-de-salle")) });
  };

  const createTable = useMutation({
    mutationFn: (body: Parameters<typeof t.api.tables.create>[0]) => t.api.tables.create(body),
    onSuccess: (row) => { void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) }); setSelectedId(row.id); },
  });
  const removeTable = useMutation({
    mutationFn: (x: DiningTable) => t.api.tables.remove(x.id),
    onSuccess: (r, x) => {
      void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) });
      setDraft((d) => { const n = { ...d }; delete n[x.id]; return n; });
      setSelectedId(null);
      toast.success(r.archived ? `Table ${x.label} désactivée (historique conservé)` : `Table ${x.label} supprimée`);
    },
    onError: (e) => toastError(e),
  });
  const removePlan = useMutation({
    mutationFn: (p: FloorPlan) => t.api.floorPlans.remove(p.id),
    onSuccess: (_r, p) => { void qc.invalidateQueries({ queryKey: tenantKeys.floorPlans(t.root) }); setPlanParam(""); toast.success(`Salle « ${p.name} » supprimée`); },
    onError: (e) => toastError(e),
  });

  const duplicate = (x: DiningTable) => {
    if (!plan) return;
    const g = geoOf(x);
    const spot = freeSpot(entries, g, plan);
    createTable.mutate(
      { label: nextLabel(mine.map((m) => m.label)), capacity: x.capacity - x.mergedTables.reduce((n, m) => n + m.capacity, 0), isActive: true, floorPlanId: plan.id, shape: g.shape, width: g.width, height: g.height, rotation: g.rotation, ...spot },
      { onSuccess: (row) => toast.success(`Table ${row.label} ajoutée`), onError: (e) => toastError(e) },
    );
  };

  return (
    <>
      <PageHeader
        title="Éditeur du plan"
        description="Glissez les tables sur la grille, ou utilisez la liste et les flèches du clavier. Rien n'est visible en salle avant l'enregistrement."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 sm:justify-end">
        <Button variant="ghost" onClick={leave}><ArrowLeft /> Plan de salle</Button>
        <Button variant="secondary" disabled={!dirty || save.isPending} onClick={discard}><Undo2 /> Annuler les modifications</Button>
        <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer{dirty ? ` (${dirtyIds.length})` : ""}</Button>
      </div>
      {plans.isError ? <ErrorState error={plans.error} onRetry={() => plans.refetch()} /> : tables.isError ? <ErrorState error={tables.error} onRetry={() => tables.refetch()} /> : !plan || tables.isLoading ? (
        <Skeleton className="h-[480px] rounded-lg" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={plan.id} onValueChange={(v) => { setPlanParam(v); setSelectedId(null); }} className="min-w-0 flex-1">
              <TabsList>{planList.map((p) => <TabsTrigger key={p.id} value={p.id} count={p.tableCount}>{p.name}</TabsTrigger>)}</TabsList>
            </Tabs>
            <Button variant="secondary" size="sm" onClick={() => setPlanDialog("new")}><Plus /> Salle</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions pour la salle ${plan.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setPlanDialog("edit")}><Pencil /> Renommer ou redimensionner</DropdownMenuItem>
                <DropdownMenuItem destructive disabled={planList.length < 2 || mine.length > 0} onSelect={() => confirm({
                  title: `Supprimer la salle « ${plan.name} » ?`, description: "La salle est vide : seul son plan disparaît.", confirmLabel: "Supprimer la salle", onConfirm: () => removePlan.mutateAsync(plan),
                })}><Trash2 /> Supprimer la salle</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Canvas
              plan={plan} tables={mine} geoOf={geoOf} selectedId={selectedId} overlapping={overlapping} zoom={zoom} setZoom={setZoom}
              onSelect={setSelectedId} onChange={update} onAdd={() => setAddOpen(true)}
            />
            <Card className="flex min-w-0 flex-col gap-4 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">Tables de la salle</h2>
                <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}><Plus /> Ajouter</Button>
              </div>
              {mine.length === 0 ? <p className="text-sm text-muted-foreground">Aucune table : ajoutez-en une.</p> : (
                <ul className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto pr-1" aria-label="Liste des tables">
                  {mine.map((x) => (
                    <li key={x.id}>
                      <button type="button" aria-pressed={x.id === selectedId} onClick={() => setSelectedId(x.id)}
                        className={cn("flex min-h-11 w-full flex-col items-start rounded-md border px-2 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", x.id === selectedId ? "border-foreground bg-hover" : "border-border hover:bg-hover")}>
                        <span className="flex w-full items-center justify-between font-semibold">{x.label}{draft[x.id] && <span aria-label="modifiée" className="size-1.5 rounded-full bg-[var(--tone-amber-dot)]" />}</span>
                        <span className="text-[11px] text-muted-foreground">{x.capacity} pl.</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selected && !selected.isActive ? null : selected && (
                <Properties
                  table={selected} geo={geoOf(selected)} overlapping={overlapping.has(selected.id)}
                  onChange={(fn) => update(selected.id, fn)} onDuplicate={() => duplicate(selected)} duplicating={createTable.isPending}
                  onRemove={() => confirm({
                    title: `Retirer la table ${selected.label} ?`,
                    description: "Une table qui n'a jamais servi est supprimée. Si elle a déjà eu des commandes, elle est seulement désactivée : l'historique reste consultable.",
                    confirmLabel: "Retirer la table", onConfirm: () => removeTable.mutateAsync(selected),
                  })}
                />
              )}
            </Card>
          </div>
        </div>
      )}
      {plan && <AddTableDialog open={addOpen} onClose={() => setAddOpen(false)} plan={plan} entries={entries} labels={mine.map((m) => m.label)} create={createTable.mutateAsync} />}
      <PlanDialog mode={planDialog} plan={plan} onClose={() => setPlanDialog(null)} onCreated={(p) => setPlanParam(p.id)} />
    </>
  );
}

// ───────────── Canevas ─────────────

function Canvas({ plan, tables, geoOf, selectedId, overlapping, zoom, setZoom, onSelect, onChange, onAdd }: {
  plan: FloorPlan; tables: DiningTable[]; geoOf: (t: DiningTable) => TableLayoutEntry; selectedId: string | null; overlapping: Set<string>;
  zoom: number | null; setZoom: (z: number | null) => void; onSelect: (id: string | null) => void;
  onChange: (id: string, fn: (e: TableLayoutEntry) => TableLayoutEntry) => void; onAdd: () => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = fitScale(width - 2, plan.width, 1);
  const scale = clamp(zoom ?? fit, 0.25, 2);
  const drag = React.useRef<{ id: string; x: number; y: number; baseX: number; baseY: number } | null>(null);
  const hint = React.useId();

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, t: DiningTable) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = geoOf(t);
    drag.current = { id: t.id, x: e.clientX, y: e.clientY, baseX: g.posX, baseY: g.posY };
    onSelect(t.id);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale;
    onChange(d.id, (g) => ({ ...g, posX: d.baseX + dx, posY: d.baseY + dy }));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, t: DiningTable) => {
    const step = e.shiftKey ? GRID * 5 : GRID;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = move[e.key];
    if (m) { e.preventDefault(); onChange(t.id, (g) => ({ ...g, posX: g.posX + m[0], posY: g.posY + m[1] })); return; }
    if (e.key.toLowerCase() === "r") { e.preventDefault(); onChange(t.id, (g) => ({ ...g, rotation: rotate(g.rotation, e.shiftKey ? -15 : 15) })); }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={hint} className="text-xs text-muted-foreground">Flèches : déplacer (Maj : par 50) · R : pivoter · grille de {GRID} unités</p>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button variant="secondary" size="icon-sm" aria-label="Zoom arrière" onClick={() => setZoom(clamp(Math.round((scale - 0.1) * 10) / 10, 0.25, 2))}><ZoomOut /></Button>
          <Button variant="ghost" size="sm" className="w-16 font-mono tabular-nums" aria-label="Ajuster à la largeur" onClick={() => setZoom(null)}>{Math.round(scale * 100)} %</Button>
          <Button variant="secondary" size="icon-sm" aria-label="Zoom avant" onClick={() => setZoom(clamp(Math.round((scale + 0.1) * 10) / 10, 0.25, 2))}><ZoomIn /></Button>
        </div>
      </div>
      <div ref={box} className="max-h-[68dvh] min-h-[280px] overflow-auto rounded-lg border border-border bg-card">
        {tables.length === 0 ? (
          <EmptyState title="Salle vide" description="Ajoutez votre première table pour la placer sur le plan." action={<Button variant="primary" onClick={onAdd}><Plus /> Ajouter une table</Button>} />
        ) : (
          <div
            role="application" aria-label={`Plan de la salle ${plan.name}`} aria-describedby={hint}
            className="relative"
            style={{
              width: plan.width * scale, height: plan.height * scale,
              backgroundImage: "radial-gradient(var(--border-strong) 1px, transparent 1px)", backgroundSize: `${GRID * 2 * scale}px ${GRID * 2 * scale}px`,
            }}
            onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
          >
            {tables.map((x) => {
              const g = geoOf(x);
              const sel = x.id === selectedId, bad = overlapping.has(x.id);
              return (
                <TileFrame
                  key={x.id} geo={g} scale={scale} minSize={0}
                  aria-label={`Table ${x.label}, ${SHAPE_LABEL[g.shape]}, ${x.capacity} places, colonne ${g.posX}, ligne ${g.posY}${bad ? ", chevauche une autre table" : ""}`}
                  onPointerDown={(e) => onPointerDown(e, x)} onPointerMove={onPointerMove}
                  onPointerUp={(e) => { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
                  onPointerCancel={() => { drag.current = null; }}
                  onFocus={() => onSelect(x.id)} onKeyDown={(e) => onKeyDown(e, x)}
                  style={{ touchAction: "none", zIndex: sel ? 2 : 1 }}
                  className={cn("cursor-grab select-none bg-background border-border-strong active:cursor-grabbing", sel && "border-foreground ring-2 ring-ring", bad && "border-[var(--tone-red-dot)] bg-[var(--tone-red-bg)]")}
                >
                  <span className="text-[14px] font-semibold tracking-tight">{x.label}</span>
                  <span className="text-[11px] text-muted-foreground">{x.capacity} pl.</span>
                </TileFrame>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────── Propriétés ─────────────

function NumField({ label, value, min, max, step = 1, onCommit }: { label: string; value: number; min?: number; max?: number; step?: number; onCommit: (v: number) => void }) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const commit = () => { const n = Number(text); if (Number.isFinite(n) && text.trim() !== "") onCommit(Math.round(n)); else setText(String(value)); };
  return (
    <Field label={label}>
      <Input type="number" inputMode="numeric" min={min} max={max} step={step} value={text} className="font-mono tabular-nums"
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    </Field>
  );
}

function Properties({ table, geo, overlapping, onChange, onDuplicate, duplicating, onRemove }: {
  table: DiningTable; geo: TableLayoutEntry; overlapping: boolean; onChange: (fn: (e: TableLayoutEntry) => TableLayoutEntry) => void;
  onDuplicate: () => void; duplicating: boolean; onRemove: () => void;
}) {
  return (
    <section aria-label={`Propriétés de la table ${table.label}`} className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Table {table.label}</h3>
      {overlapping && <Callout tone="warning">Cette table chevauche une autre table.</Callout>}
      <Segmented<TableShape> ariaLabel="Forme" size="sm" value={geo.shape} options={SHAPES} onChange={(s) => onChange((e) => reshape(e, s))} />
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Position X" value={geo.posX} min={0} step={GRID} onCommit={(v) => onChange((e) => ({ ...e, posX: v }))} />
        <NumField label="Position Y" value={geo.posY} min={0} step={GRID} onCommit={(v) => onChange((e) => ({ ...e, posY: v }))} />
        <NumField label="Largeur" value={geo.width} min={MIN_SIZE} max={MAX_SIZE} step={GRID} onCommit={(v) => onChange((e) => (e.shape === "rect" ? { ...e, width: v } : { ...e, width: v, height: v }))} />
        <NumField label="Hauteur" value={geo.height} min={MIN_SIZE} max={MAX_SIZE} step={GRID} onCommit={(v) => onChange((e) => (e.shape === "rect" ? { ...e, height: v } : { ...e, width: v, height: v }))} />
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1"><NumField label="Rotation (°)" value={geo.rotation} min={0} max={359} step={15} onCommit={(v) => onChange((e) => ({ ...e, rotation: rotate(v, 0) }))} /></div>
        <Button variant="secondary" size="icon" aria-label="Pivoter de 15° à gauche" onClick={() => onChange((e) => ({ ...e, rotation: rotate(e.rotation, -15) }))}><RotateCcw /></Button>
        <Button variant="secondary" size="icon" aria-label="Pivoter de 15° à droite" onClick={() => onChange((e) => ({ ...e, rotation: rotate(e.rotation, 15) }))}><RotateCw /></Button>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" loading={duplicating} onClick={onDuplicate}><Copy /> Dupliquer</Button>
        <Button variant="secondary" className="flex-1 text-danger" disabled={table.openOrders.length > 0} onClick={onRemove}><Trash2 /> Retirer</Button>
      </div>
    </section>
  );
}

// ───────────── Dialogues ─────────────

function AddTableDialog({ open, onClose, plan, entries, labels, create }: {
  open: boolean; onClose: () => void; plan: FloorPlan; entries: TableLayoutEntry[]; labels: string[];
  create: (body: Parameters<ReturnType<typeof useTenant>["api"]["tables"]["create"]>[0]) => Promise<DiningTable>;
}) {
  const [label, setLabel] = React.useState("");
  const [capacity, setCapacity] = React.useState("4");
  const [shape, setShape] = React.useState<TableShape>("round");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setLabel(nextLabel(labels)); setCapacity("4"); setShape("round"); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const cap = Number(capacity);
    if (!label.trim()) return setError("Donnez un numéro à la table");
    if (!Number.isInteger(cap) || cap < 1 || cap > 50) return setError("La capacité doit être entre 1 et 50 places");
    setBusy(true); setError(null);
    try {
      const size = DEFAULT_SIZE[shape];
      const row = await create({ label: label.trim(), capacity: cap, isActive: true, floorPlanId: plan.id, shape, ...size, rotation: 0, ...freeSpot(entries, size, plan) });
      toast.success(`Table ${row.label} ajoutée`);
      onClose();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }} size="sm" title="Ajouter une table" description={`Elle est placée dans la salle « ${plan.name} » : déplacez-la ensuite sur le plan.`}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Numéro ou nom" required><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={20} autoFocus /></Field>
        <Field label="Places" required><Input type="number" inputMode="numeric" min={1} max={50} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="font-mono tabular-nums" /></Field>
        <Segmented<TableShape> ariaLabel="Forme" value={shape} options={SHAPES} onChange={setShape} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" loading={busy}><Plus /> Ajouter</Button>
        </div>
      </form>
    </Dialog>
  );
}

function PlanDialog({ mode, plan, onClose, onCreated }: { mode: "new" | "edit" | null; plan?: FloorPlan; onClose: () => void; onCreated: (p: FloorPlan) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const [name, setName] = React.useState("");
  const [width, setWidth] = React.useState("1000");
  const [height, setHeight] = React.useState("700");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!mode) return;
    setError(null);
    if (mode === "edit" && plan) { setName(plan.name); setWidth(String(plan.width)); setHeight(String(plan.height)); } else { setName(""); setWidth("1000"); setHeight("700"); }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), width: Number(width), height: Number(height) };
      return mode === "edit" && plan ? t.api.floorPlans.update(plan.id, body) : t.api.floorPlans.create(body);
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: tenantKeys.floorPlans(t.root) });
      toast.success(mode === "edit" ? "Salle mise à jour" : `Salle « ${p.name} » créée`);
      if (mode === "new") onCreated(p);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog open={!!mode} onOpenChange={(o) => { if (!o) onClose(); }} size="sm" title={mode === "edit" ? "Modifier la salle" : "Nouvelle salle"} description="Les dimensions sont en unités du plan (la grille fait 10 unités).">
      <form onSubmit={(e) => { e.preventDefault(); run.mutate(); }} className="flex flex-col gap-4">
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Nom" required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Terrasse" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Largeur"><Input type="number" inputMode="numeric" min={400} max={4000} step={50} value={width} onChange={(e) => setWidth(e.target.value)} className="font-mono tabular-nums" /></Field>
          <Field label="Hauteur"><Input type="number" inputMode="numeric" min={400} max={4000} step={50} value={height} onChange={(e) => setHeight(e.target.value)} className="font-mono tabular-nums" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
          <Button type="submit" variant="primary" loading={run.isPending}>{mode === "edit" ? "Enregistrer" : "Créer la salle"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
