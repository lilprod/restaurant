import { ApiError, type Delivery, type DeliveryPhase } from "@restaurant/api-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bike, ChefHat, CircleCheck, CircleX, PackageCheck, Truck } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { NativeSelect } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveIndicator } from "@/components/live-indicator";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { DELIVERY_PHASE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useOperations, useTenant } from "../hooks";
import { DeliveryMeta, DeliveryStatusBadge } from "./delivery-bits";
import { useApplyDelivery, useDeliveryBoard } from "./delivery-hooks";
import { SettlementsTab } from "./settlements-tab";
import { ZonesTab } from "./zones-tab";

const PHASES: { phase: DeliveryPhase; icon: React.ReactNode }[] = [
  { phase: "preparing", icon: <ChefHat /> },
  { phase: "ready", icon: <PackageCheck /> },
  { phase: "on_the_way", icon: <Bike /> },
  { phase: "delivered", icon: <CircleCheck /> },
  { phase: "failed", icon: <CircleX /> },
];

/** Livraisons : tableau de dispatch en temps réel (salle), zones et rapprochement des encaissements (responsables). */
export function DeliveryPage() {
  const t = useTenant();
  const ops = useOperations();
  const to = useSpacePath();
  const board = useDeliveryBoard();
  const [tab, setTab] = useUrlParam("onglet", "dispatch");
  const blocked = board.error instanceof ApiError && board.error.status === 403;
  const unsettled = useQuery({ queryKey: tenantKeys.deliverySettlements(t.root), queryFn: t.api.delivery.settlements, enabled: t.isManager && !blocked });

  return (
    <div className="flex flex-col gap-2">
      <PageHeader title="Livraisons" description="Attribuez les commandes aux livreurs, suivez les courses et rapprochez les encaissements à leur retour."
        actions={!blocked && <LiveIndicator />} />
      {blocked ? (
        <EmptyState icon={<Truck />} title="Livraison non incluse dans votre plan" description={board.error instanceof Error ? board.error.message : undefined} />
      ) : (
        <>
          {!ops.deliveryEnabled && (
            <Callout tone="warning" title="La livraison est désactivée">
              {t.isAdmin ? <>Activez-la dans <Link className="underline underline-offset-4" to={to("/parametres")}>Paramètres</Link> pour prendre des commandes en livraison.</> : "Demandez à l'administrateur de l'activer dans les paramètres."}
            </Callout>
          )}
          <Tabs value={tab} onValueChange={setTab} className="mt-2">
            <TabsList>
              <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
              {t.isManager && <TabsTrigger value="rapprochement" count={unsettled.data?.drivers.reduce((n, d) => n + d.count, 0) || undefined}>Rapprochement</TabsTrigger>}
              {t.isManager && <TabsTrigger value="zones">Zones et frais</TabsTrigger>}
            </TabsList>
            <TabsContent value="dispatch" className="pt-5"><Dispatch /></TabsContent>
            {t.isManager && <TabsContent value="rapprochement" className="pt-5"><SettlementsTab /></TabsContent>}
            {t.isManager && <TabsContent value="zones" className="pt-5"><ZonesTab /></TabsContent>}
          </Tabs>
        </>
      )}
    </div>
  );
}

function Dispatch() {
  const board = useDeliveryBoard();
  if (board.isError) return <ErrorState error={board.error} onRetry={() => board.refetch()} />;
  if (board.isLoading) return <div className="grid gap-4 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>;
  const items = board.data?.items ?? [];
  if (!items.length) {
    return <EmptyState icon={<Truck />} title="Aucune livraison en cours" description="Les commandes en livraison apparaissent ici dès leur création, depuis « Nouvelle commande » → Livraison." />;
  }
  return (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-5" data-testid="dispatch-board">
      {PHASES.map(({ phase, icon }) => {
        const col = items.filter((d) => d.phase === phase);
        return (
          <section key={phase} aria-label={DELIVERY_PHASE_LABEL[phase]} data-testid={`col-${phase}`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-subtle p-3">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
              {icon}{DELIVERY_PHASE_LABEL[phase]}<span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{col.length}</span>
            </h2>
            {col.length === 0 ? <p className="py-4 text-center text-[13px] text-faint">Aucune</p> : col.map((d) => <DeliveryCard key={d.id} d={d} />)}
          </section>
        );
      })}
    </div>
  );
}

function DeliveryCard({ d }: { d: Delivery }) {
  const t = useTenant();
  const apply = useApplyDelivery();
  const drivers = useQuery({ queryKey: tenantKeys.deliveryDrivers(t.root), queryFn: t.api.delivery.drivers, staleTime: 30_000 });
  const assign = useMutation({
    mutationFn: (driverId: string) => t.api.delivery.assign(d.id, driverId),
    onSuccess: (r) => { apply(r); toast.success(`Commande n°${r.order.number} attribuée à ${r.driver?.name}`); },
    onError: (e) => toastError(e),
  });
  const canAssign = d.status === "PENDING" || d.status === "ASSIGNED" || d.status === "FAILED";
  const to = useSpacePath();
  const inputId = `drv-${d.id}`;
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 shadow-xs" data-testid="delivery-card" data-status={d.status}>
      <header className="flex items-start justify-between gap-2">
        <Link to={to(`/commandes/${d.order.id}`)} className="font-mono text-[15px] font-semibold underline-offset-4 hover:underline">n°{d.order.number}</Link>
        <DeliveryStatusBadge status={d.status} />
      </header>
      <p className="text-sm font-medium leading-snug">{d.order.customerName} <span className="font-normal text-muted-foreground">· {d.neighborhood}</span></p>
      <p className="line-clamp-2 text-[13px] text-muted-foreground">{d.order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="whitespace-nowrap font-mono tabular-nums">{formatFcfa(d.order.total)}</span>
        {d.order.remaining > 0 ? <Badge tone="amber">À encaisser</Badge> : <Badge tone="green">Réglée</Badge>}
      </div>
      <DeliveryMeta d={d} />
      {d.failReason && d.status === "FAILED" && <p role="note" className="text-[13px] text-[var(--tone-red-fg)]">Motif : {d.failReason}</p>}
      {d.status === "DELIVERED" && d.collectedPaymentId && !d.settledAt && <Badge tone="amber" className="w-fit">À rapprocher en caisse</Badge>}
      {canAssign && (
        <div className="flex flex-col gap-1">
          <label htmlFor={inputId} className="sr-only">Livreur de la commande n°{d.order.number}</label>
          <NativeSelect id={inputId} value="" disabled={assign.isPending || drivers.isLoading} onChange={(e) => e.target.value && assign.mutate(e.target.value)}
            className={cn("h-11 sm:h-9", assign.isPending && "opacity-60")}>
            <option value="">{d.driver ? `Changer` : d.status === "FAILED" ? "Réattribuer à…" : "Attribuer à…"}</option>
            {drivers.data?.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.assigned + x.onTheWay} en cours)</option>)}
          </NativeSelect>
          {drivers.data?.length === 0 && <p className="text-xs text-muted-foreground">Aucun livreur : créez un compte au rôle « Livreur » dans Équipe.</p>}
        </div>
      )}
    </article>
  );
}
