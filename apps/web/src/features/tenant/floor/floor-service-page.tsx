import type { DiningTable } from "@restaurant/api-client";
import { LayoutGrid, Map as MapIcon, Pencil } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useNow, useTenant, useTimezone } from "../hooks";
import { TableCard, useAllTables } from "../tables/tables-page";
import { fitScale, layoutOf, nextReservationFor, planTables, tileState, type TileState } from "./floor-geometry";
import { useFloorPlans, useSoonReservations } from "./floor-hooks";
import { TableActionsDialog } from "./table-actions-dialog";
import { ServiceTile, TILE_DOT, TILE_LABEL } from "./table-tile";

type Mode = "plan" | "liste";
const STATES: TileState[] = ["free", "occupied", "cleaning", "soon"];

/** Plan de salle en direct : couleur selon l'état, commande en cours, réservation proche ; toucher une table ouvre ses actions. */
export function FloorServicePage() {
  const t = useTenant();
  const to = useSpacePath();
  const tz = useTimezone();
  const plans = useFloorPlans();
  const tables = useAllTables();
  const reservations = useSoonReservations();
  const now = useNow(30_000);
  const [planParam, setPlanParam] = useUrlParam("salle", "");
  const [mode, setMode] = useUrlParam("vue", typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "plan" : "liste");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const planList = plans.data ?? [];
  const plan = planList.find((p) => p.id === planParam) ?? planList[0];
  const all = tables.data ?? [];
  const mine = plan ? planTables(all, plan.id) : [];
  const byId = new Map(all.map((x) => [x.id, x]));
  const soonOf = (x: DiningTable) => nextReservationFor([x.id, ...x.mergedTables.map((m) => m.id)], reservations.data, now);
  const stateOf = (x: DiningTable) => tileState(x, soonOf(x));
  const primaries = mine.filter((x) => !x.mergedIntoId);
  const counts = Object.fromEntries(STATES.map((s) => [s, primaries.filter((x) => stateOf(x) === s).length])) as Record<TileState, number>;
  const open = openId ? byId.get(openId) ?? null : null;
  const openTarget = open?.mergedIntoId ? byId.get(open.mergedIntoId) ?? open : open;

  return (
    <>
      <PageHeader
        title="Plan de salle"
        description="La salle en direct. Touchez une table pour agir."
        actions={t.isManager && <Button asChild variant="secondary"><Link to={to("/plan-de-salle/editeur")}><Pencil /> Modifier le plan</Link></Button>}
      />
      {plans.isError ? <ErrorState error={plans.error} onRetry={() => plans.refetch()} /> : tables.isError ? <ErrorState error={tables.error} onRetry={() => tables.refetch()} /> : !plan || tables.isLoading ? (
        <Skeleton className="h-[420px] rounded-lg" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {planList.length > 1 ? (
              <Tabs value={plan.id} onValueChange={(v) => setPlanParam(v)} className="min-w-0 flex-1">
                <TabsList>{planList.map((p) => <TabsTrigger key={p.id} value={p.id} count={p.tableCount}>{p.name}</TabsTrigger>)}</TabsList>
              </Tabs>
            ) : <span />}
            <Segmented<Mode> ariaLabel="Affichage" size="sm" value={mode as Mode} onChange={setMode}
              options={[{ value: "plan", label: <span className="inline-flex items-center gap-1.5"><MapIcon className="size-3.5" aria-hidden /> Plan</span> }, { value: "liste", label: <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" aria-hidden /> Liste</span> }]} />
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]" aria-label="Légende">
            {STATES.map((s) => (
              <li key={s} className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-2.5 rounded-full ${TILE_DOT[s]}`} />{TILE_LABEL[s]} <span className="font-mono text-xs tabular-nums text-muted-foreground">{counts[s]}</span></li>
            ))}
          </ul>
          {primaries.length === 0 ? (
            <Card><EmptyState icon={<MapIcon />} title="Aucune table dans cette salle"
              description={t.isManager ? "Ouvrez l'éditeur pour placer vos tables." : "Un responsable doit placer les tables de cette salle."}
              action={t.isManager ? <Button asChild variant="primary"><Link to={to("/plan-de-salle/editeur")}><Pencil /> Modifier le plan</Link></Button> : undefined} /></Card>
          ) : mode === "plan" ? (
            <PlanSurface plan={plan} tables={mine} byId={byId} stateOf={stateOf} soonOf={soonOf} now={now} tz={tz} openId={openTarget?.id ?? null} onOpen={setOpenId} />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {primaries.map((x) => <li key={x.id}><TableCard table={x} now={now} compact /></li>)}
            </ul>
          )}
        </div>
      )}
      <TableActionsDialog table={openTarget} tables={all} plans={planList} soon={openTarget ? soonOf(openTarget) : null} now={now} onClose={() => setOpenId(null)} />
    </>
  );
}

function PlanSurface({ plan, tables, byId, stateOf, soonOf, now, tz, openId, onOpen }: {
  plan: { width: number; height: number }; tables: DiningTable[]; byId: Map<string, DiningTable>;
  stateOf: (t: DiningTable) => TileState; soonOf: (t: DiningTable) => ReturnType<typeof nextReservationFor>;
  now: number; tz: string; openId: string | null; onOpen: (id: string) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = fitScale(width, plan.width);
  return (
    <Card className="overflow-hidden p-0">
      <div ref={ref} className="w-full">
        <div
          role="group" aria-label="Plan de la salle"
          className="relative"
          style={{
            height: plan.height * scale,
            backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: `${20 * scale}px ${20 * scale}px`,
          }}
        >
          {tables.map((x) => {
            const group = x.mergedIntoId ? byId.get(x.mergedIntoId) : undefined;
            const head = group ?? x;
            return (
              <ServiceTile
                key={x.id} table={x} geo={layoutOf(x)} scale={scale} state={stateOf(head)} soon={soonOf(head)} group={group}
                now={now} tz={tz} selected={openId === head.id} onOpen={() => onOpen(head.id)}
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
}
