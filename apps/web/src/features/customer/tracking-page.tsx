import { ApiError, type OrderTracking, type TrackingStage } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import { Bike, Check, ChefHat, ClockAlert, Phone, ReceiptText, Star, UtensilsCrossed } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { publicSpace } from "@/app/spaces";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { useSpacePath } from "@/providers/space";
import { fmtTime } from "../tenant/reservations/time";
import { PublicShell } from "../public-reservation/shared";
import { ReviewCard } from "./review-form";

const STEPS: { stage: Exclude<TrackingStage, "cancelled" | "done">; label: string; icon: React.ReactNode }[] = [
  { stage: "received", label: "Reçue", icon: <ReceiptText /> },
  { stage: "preparing", label: "En préparation", icon: <ChefHat /> },
  { stage: "ready", label: "Prête", icon: <UtensilsCrossed /> },
];
const DELIVERY_STEPS: typeof STEPS = [
  { stage: "received", label: "Reçue", icon: <ReceiptText /> },
  { stage: "preparing", label: "En préparation", icon: <ChefHat /> },
  { stage: "on_the_way", label: "En route", icon: <Bike /> },
];
const ORDER: Record<TrackingStage, number> = { received: 0, preparing: 1, ready: 2, on_the_way: 2, done: 3, cancelled: -1 };
export const POLL_MS = 5000;

const HEADLINE: Record<TrackingStage, string> = {
  received: "Votre commande est bien reçue",
  preparing: "On prépare votre commande",
  ready: "Votre commande est prête !",
  on_the_way: "Votre commande est en route",
  done: "Merci, bon appétit !",
  cancelled: "Cette commande a été annulée",
};

/** Suivi d'une commande par le lien du ticket (sans compte) : statut mis à jour automatiquement toutes les 5 secondes. */
export function TrackingPage() {
  const { token = "" } = useParams();
  const to = useSpacePath();
  const q = useQuery({
    queryKey: ["public", "tracking", token],
    queryFn: () => publicSpace.tracking(token),
    refetchInterval: (query) => { const s = query.state.data?.stage; return s === "done" || s === "cancelled" || query.state.error ? false : POLL_MS; },
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });

  if (q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410)) {
    const gone = q.error.status === 410;
    return (
      <PublicShell title="Suivi de commande">
        <EmptyState icon={<ClockAlert />} title={gone ? "Ce lien a expiré" : "Lien invalide"}
          description={gone ? "Le suivi n'est disponible que 24 heures après la fin de la commande." : "Cette commande est introuvable. Vérifiez le lien imprimé sur votre ticket."} />
      </PublicShell>
    );
  }
  if (q.isError && !q.data) return <PublicShell title="Suivi de commande"><ErrorState error={q.error} onRetry={() => q.refetch()} /></PublicShell>;
  const o = q.data;
  if (!o) return <PublicShell title="Suivi de commande"><div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-9 w-64" /><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div></PublicShell>;
  return (
    <PublicShell title={`Commande n°${o.number}`}>
      <div className="flex flex-col gap-6" data-testid="tracking">
        <Header o={o} />
        {o.stage !== "cancelled" && <Progress stage={o.stage} steps={o.type === "DELIVERY" ? DELIVERY_STEPS : STEPS} />}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Votre commande</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[15px]">
            {o.items.map((i, k) => <li key={k} className="flex gap-3"><span className="w-7 shrink-0 font-mono tabular-nums text-muted-foreground">{i.quantity}×</span><span>{i.name}</span></li>)}
          </ul>
          <p className="mt-4 border-t border-border pt-3 text-[13px] text-muted-foreground">
            {o.restaurant.name}{o.restaurant.phone && <> · <Phone className="inline size-3" /> <a className="font-mono underline-offset-4 hover:underline" href={`tel:${o.restaurant.phone}`}>{o.restaurant.phone}</a></>}
          </p>
        </div>
        {o.stage !== "done" && o.stage !== "cancelled" && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="off">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--tone-green-dot)] opacity-60 motion-reduce:hidden" /><span className="relative inline-flex size-2 rounded-full bg-[var(--tone-green-dot)]" /></span>
            Mise à jour automatique · dernière à {fmtTime(new Date(q.dataUpdatedAt || Date.now()), o.restaurant.timezone)}
          </p>
        )}
        {o.canReview && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-subtle p-5">
            <p className="font-medium">Votre commande s'est bien passée ?</p>
            <p className="text-sm text-muted-foreground">Donnez votre avis en quelques secondes : il aide le restaurant à progresser.</p>
            <Button asChild variant="primary" size="lg" className="w-fit"><Link to={to(`/avis/${token}`)}><Star /> Donner mon avis</Link></Button>
          </div>
        )}
        {o.review && <div className="flex flex-col gap-2"><h2 className="text-sm font-semibold">Votre avis</h2><ReviewCard review={o.review} restaurant={o.restaurant.name} /></div>}
      </div>
    </PublicShell>
  );
}

function Header({ o }: { o: OrderTracking }) {
  const ready = o.stage === "ready" && o.type !== "DELIVERY";
  const driver = o.delivery?.driver;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{o.typeLabel}{o.table ? ` · Table ${o.table}` : ""} · commande n°<span className="font-mono">{o.number}</span></p>
      <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight text-balance">{o.type === "DELIVERY" && o.stage === "ready" ? "Votre commande est prête, le livreur arrive la chercher" : HEADLINE[o.stage]}</h1>
      <div aria-live="polite" role="status">
        {ready && <Callout tone="success" title="Vous pouvez venir la retirer.">Présentez le numéro {o.number} au comptoir.</Callout>}
        {o.stage === "on_the_way" && (
          <Callout tone="info" title={o.delivery?.eta ? `Arrivée estimée vers ${fmtTime(new Date(o.delivery.eta), o.restaurant.timezone)}` : "Le livreur est en chemin."}>
            {driver ? <>Votre livreur : {driver.firstName}{driver.phone && <> · <a className="font-mono underline underline-offset-4" href={`tel:${driver.phone}`}>{driver.phone}</a></>}</> : "Gardez votre téléphone à portée de main."}
          </Callout>
        )}
        {o.stage === "cancelled" && <Callout tone="danger">Rapprochez-vous du restaurant pour en savoir plus{o.restaurant.phone ? ` au ${o.restaurant.phone}` : ""}.</Callout>}
      </div>
    </div>
  );
}

/** Trois étapes : reçue, en préparation, prête (ou en route pour une livraison) ; l'étape courante est mise en avant. */
function Progress({ stage, steps }: { stage: TrackingStage; steps: typeof STEPS }) {
  const reduce = useReducedMotion();
  const at = ORDER[stage];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Avancement de la commande">
      {steps.map((s, i) => {
        const done = at > i, current = at === i;
        return (
          <li key={s.stage} aria-current={current ? "step" : undefined} className="flex flex-col items-center gap-2 text-center">
            <motion.span
              initial={false} animate={reduce ? undefined : { scale: current ? 1.08 : 1 }} transition={{ duration: 0.2 }}
              className={cn("flex size-12 items-center justify-center rounded-full border text-muted-foreground [&_svg]:size-5",
                done && "border-transparent bg-brand text-brand-foreground", current && "border-transparent bg-brand text-brand-foreground ring-4 ring-ring/30", !done && !current && "border-border bg-card")}
            >
              {done ? <Check /> : s.icon}
            </motion.span>
            <span className={cn("text-[13px] leading-tight", current || done ? "font-medium text-foreground" : "text-muted-foreground")}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
