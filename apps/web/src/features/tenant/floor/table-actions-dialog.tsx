import type { DiningTable, Reservation } from "@restaurant/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Brush, CheckCircle2, ClipboardList, Combine, Split, SquarePlus, Users, UtensilsCrossed } from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { TABLE_STATUS_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { tableStatusTone } from "@restaurant/ui-tokens";
import { elapsedLabel, useTenant, useTimezone } from "../hooks";
import { OrderStatusBadge } from "../orders/order-bits";
import { useReservationAction } from "../reservations/hooks";
import { fmtTime } from "../reservations/time";
import type { FloorPlan } from "@restaurant/api-client";

type Step = { kind: "main" } | { kind: "move"; orderId: string; number: number } | { kind: "merge" };

const tap = "min-h-14 w-full justify-start gap-3 text-[15px] sm:min-h-12";

/** Actions d'une table du plan de service : commande, réservation, déplacement, fusion, débarrassage. */
export function TableActionsDialog({ table, tables, plans, soon, now, onClose }: {
  table: DiningTable | null; tables: DiningTable[]; plans: FloorPlan[]; soon: Reservation | null; now: number; onClose: () => void;
}) {
  const [step, setStep] = React.useState<Step>({ kind: "main" });
  const [picked, setPicked] = React.useState<string[]>([]);
  React.useEffect(() => { setStep({ kind: "main" }); setPicked([]); }, [table?.id]);
  const open = !!table;
  const last = React.useRef(table);
  if (table) last.current = table;
  const tb = table ?? last.current;
  const title = tb ? `Table ${tb.label}${tb.mergedTables.length ? ` + ${tb.mergedTables.map((m) => m.label).join(" + ")}` : ""}` : "Table";
  return (
    <Dialog
      open={open} onOpenChange={(o) => { if (!o) onClose(); }} size="sm" title={title}
      description={tb ? <span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={tb.status} labels={TABLE_STATUS_LABEL} toneOf={tableStatusTone} /><span className="inline-flex items-center gap-1"><Users className="size-3.5" aria-hidden />{tb.capacity} places</span></span> : undefined}
    >
      {tb && (step.kind === "main"
        ? <Main table={tb} soon={soon} now={now} setStep={setStep} onClose={onClose} />
        : step.kind === "move"
          ? <MoveStep table={tb} tables={tables} plans={plans} orderId={step.orderId} number={step.number} onBack={() => setStep({ kind: "main" })} onDone={onClose} />
          : <MergeStep table={tb} tables={tables} picked={picked} setPicked={setPicked} onBack={() => setStep({ kind: "main" })} onDone={onClose} />)}
    </Dialog>
  );
}

function Main({ table, soon, now, setStep, onClose }: { table: DiningTable; soon: Reservation | null; now: number; setStep: (s: Step) => void; onClose: () => void }) {
  const t = useTenant();
  const to = useSpacePath();
  const tz = useTimezone();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const go = (path: string) => { onClose(); navigate(to(path)); };
  const refresh = () => void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) });
  const seat = useReservationAction((_a, r) => { toast.success(`${r.guestName} installé${r.partySize > 1 ? "s" : ""} à la table ${table.label}`); onClose(); });
  const status = useMutation({
    mutationFn: (s: "FREE" | "CLEANING") => t.api.tables.setStatus(table.id, s),
    onSuccess: (_r, s) => { refresh(); toast.success(s === "FREE" ? `Table ${table.label} libre` : `Table ${table.label} à débarrasser`); onClose(); },
    onError: (e) => toastError(e),
  });
  const split = useMutation({
    mutationFn: () => t.api.tables.split(table.id),
    onSuccess: () => { refresh(); toast.success("Tables séparées"); onClose(); },
    onError: (e) => toastError(e),
  });
  const orders = table.openOrders;
  const canAct = t.isFloor && table.isActive;
  return (
    <div className="flex flex-col gap-4">
      {orders.length > 0 && (
        <section aria-label="Commandes en cours" className="flex flex-col gap-2">
          {orders.map((o) => (
            <div key={o.id} className="rounded-lg border border-border">
              <button type="button" onClick={() => go(`/commandes/${o.id}`)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-t-lg px-3 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="flex flex-col"><span className="font-medium">Commande n°{o.number}</span><span className="font-mono text-xs text-muted-foreground tabular-nums">ouverte depuis {elapsedLabel(o.createdAt, now)}</span></span>
                <span className="flex flex-col items-end gap-1"><span className="font-mono text-sm font-medium tabular-nums">{formatFcfa(o.total)}</span><OrderStatusBadge status={o.status} className="h-5 text-[11px]" /></span>
              </button>
              {canAct && (
                <Button variant="ghost" className="min-h-12 w-full justify-start gap-3 rounded-t-none border-t border-border" onClick={() => setStep({ kind: "move", orderId: o.id, number: o.number })}>
                  <ArrowRightLeft /> Déplacer la commande n°{o.number}
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      {soon && canAct && (
        <section aria-label="Réservation" className="rounded-lg border border-dashed border-border p-3">
          <p className="text-sm"><span className="font-mono font-semibold tabular-nums">{fmtTime(soon.startsAt, tz)}</span> · {soon.guestName} · {soon.partySize} pers.</p>
          <Button variant="primary" className="mt-2 min-h-12 w-full" loading={seat.isPending} onClick={() => seat.mutate({ id: soon.id, action: "seat" })}>
            <UtensilsCrossed /> Installer {soon.guestName}
          </Button>
        </section>
      )}
      <div className="flex flex-col gap-1.5">
        {canAct && orders.length === 0 && (
          <Button variant={soon ? "secondary" : "primary"} className={tap} onClick={() => go(`/commandes/nouvelle?table=${table.id}`)}><SquarePlus /> Nouvelle commande</Button>
        )}
        {canAct && orders.length > 0 && (
          <Button variant="secondary" className={tap} onClick={() => go(`/commandes/nouvelle?table=${table.id}`)}><ClipboardList /> Ajouter une commande</Button>
        )}
        {canAct && orders.length === 0 && (table.status === "CLEANING"
          ? <Button variant="secondary" className={tap} loading={status.isPending} onClick={() => status.mutate("FREE")}><CheckCircle2 /> Marquer débarrassée</Button>
          : table.status === "FREE" && <Button variant="secondary" className={tap} loading={status.isPending} onClick={() => status.mutate("CLEANING")}><Brush /> Marquer à débarrasser</Button>)}
        {canAct && !table.mergedTables.length && <Button variant="secondary" className={tap} onClick={() => setStep({ kind: "merge" })}><Combine /> Fusionner avec d'autres tables</Button>}
        {canAct && table.mergedTables.length > 0 && (
          <Button variant="secondary" className={tap} loading={split.isPending} disabled={table.status === "OCCUPIED" || orders.length > 0}
            onClick={() => confirm({ title: "Séparer les tables ?", description: `Les tables ${[table.label, ...table.mergedTables.map((m) => m.label)].join(", ")} redeviennent indépendantes.`, confirmLabel: "Séparer", onConfirm: () => split.mutateAsync() })}>
            <Split /> Séparer les tables
          </Button>
        )}
        {canAct && table.mergedTables.length > 0 && (table.status === "OCCUPIED" || orders.length > 0) && (
          <p className="px-1 text-xs text-muted-foreground">Encaissez la commande avant de séparer les tables.</p>
        )}
      </div>
    </div>
  );
}

function MoveStep({ table, tables, plans, orderId, number, onBack, onDone }: {
  table: DiningTable; tables: DiningTable[]; plans: FloorPlan[]; orderId: string; number: number; onBack: () => void; onDone: () => void;
}) {
  const t = useTenant();
  const qc = useQueryClient();
  const free = tables.filter((x) => x.isActive && !x.mergedIntoId && x.id !== table.id && x.openOrders.length === 0 && x.status !== "OCCUPIED");
  const move = useMutation({
    mutationFn: (tableId: string) => t.api.orders.move(orderId, tableId),
    onSuccess: (o) => { void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) }); toast.success(`Commande n°${number} déplacée sur la table ${o.table?.label}`); onDone(); },
    onError: (e) => toastError(e),
  });
  const planName = (id: string) => (plans.length > 1 ? plans.find((p) => p.id === id)?.name : undefined);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Choisissez la table libre qui reçoit la commande n°{number}.</p>
      {free.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Aucune table libre pour le moment.</p> : (
        <ul className="grid grid-cols-2 gap-2">
          {free.map((x) => (
            <li key={x.id}>
              <Button variant="secondary" className="min-h-14 w-full flex-col items-start gap-0 px-3 text-left" disabled={move.isPending} onClick={() => move.mutate(x.id)}>
                <span className="text-base font-semibold">{x.label}</span>
                <span className="text-xs font-normal text-muted-foreground">{x.capacity} places{planName(x.floorPlanId) ? ` · ${planName(x.floorPlanId)}` : ""}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" onClick={onBack}>Retour</Button>
    </div>
  );
}

function MergeStep({ table, tables, picked, setPicked, onBack, onDone }: {
  table: DiningTable; tables: DiningTable[]; picked: string[]; setPicked: (v: string[]) => void; onBack: () => void; onDone: () => void;
}) {
  const t = useTenant();
  const qc = useQueryClient();
  const mine = table.openOrders.length > 0;
  const candidates = tables.filter((x) => x.isActive && !x.mergedIntoId && x.id !== table.id && x.floorPlanId === table.floorPlanId && !(x.status === "OCCUPIED" && x.openOrders.length === 0) && !(mine && x.openOrders.length));
  const merge = useMutation({
    mutationFn: () => t.api.tables.merge([table.id, ...picked]),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: tenantKeys.tables(t.root) }); toast.success(`Tables fusionnées : ${r.capacity} places`); onDone(); },
    onError: (e) => toastError(e),
  });
  const total = table.capacity + candidates.filter((x) => picked.includes(x.id)).reduce((n, x) => n + x.capacity, 0);
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Cochez les tables à réunir avec la table {table.label}. La commande reste unique.</p>
      {candidates.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Aucune autre table disponible dans cette salle.</p> : (
        <ul className="grid grid-cols-2 gap-2">
          {candidates.map((x) => {
            const on = picked.includes(x.id);
            return (
              <li key={x.id}>
                <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(x.id)}
                  className={`flex min-h-14 w-full flex-col items-start justify-center rounded-lg border px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-foreground bg-hover" : "border-border hover:bg-hover"}`}>
                  <span className="flex items-center gap-1.5 text-base font-semibold">{on && <CheckCircle2 className="size-4" aria-hidden />}{x.label}</span>
                  <span className="text-xs text-muted-foreground">{x.capacity} places{x.openOrders.length ? " · commande" : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack}>Retour</Button>
        <Button variant="primary" className="min-h-12 flex-1" disabled={picked.length === 0} loading={merge.isPending} onClick={() => merge.mutate()}>
          <Combine /> Fusionner{picked.length ? ` (${total} places)` : ""}
        </Button>
      </div>
    </div>
  );
}
