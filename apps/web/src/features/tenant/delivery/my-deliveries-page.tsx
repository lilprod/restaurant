import type { Delivery, DeliveryCollectMethod } from "@restaurant/api-client";
import { completeDeliverySchema } from "@restaurant/validation";
import { useMutation } from "@tanstack/react-query";
import { Banknote, Bike, CircleX, Clock, Navigation, PackageCheck, Phone, Smartphone, Truck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveIndicator } from "@/components/live-indicator";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatFcfa, formatTime } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { useTenant } from "../hooks";
import { DeliveryAddress, DeliveryStatusBadge } from "./delivery-bits";
import { mapsLink, telLink, useApplyDelivery, useMyDeliveries } from "./delivery-hooks";

const FAIL_REASONS = ["Client injoignable", "Adresse introuvable", "Client absent", "Refus de la commande"];
const rank = (d: Delivery) => (d.status === "ON_THE_WAY" ? 0 : d.status === "ASSIGNED" ? (d.order.status === "READY" ? 1 : 2) : 3);

/** « Mes livraisons » (livreur, mobile d'abord) : ses livraisons seulement, appel, itinéraire, récupéré / livré / échec, encaissement à la remise. */
export function MyDeliveriesPage() {
  const q = useMyDeliveries();
  const [done, setDone] = React.useState<Delivery | null>(null);
  const [failing, setFailing] = React.useState<Delivery | null>(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = [...(q.data?.items ?? [])].sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
  const todo = items.filter((d) => d.status === "ASSIGNED" || d.status === "ON_THE_WAY");
  const finished = items.filter((d) => d.status === "DELIVERED" || d.status === "FAILED");
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5" data-testid="my-deliveries">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Mes livraisons</h1>
        <LiveIndicator />
      </header>
      {q.isLoading ? (
        <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
      ) : (
        <>
          {todo.length === 0 ? (
            <EmptyState icon={<Truck />} title="Aucune livraison à faire" description="Dès qu'une commande vous est attribuée, elle apparaît ici, sans recharger la page." />
          ) : (
            <ul className="flex flex-col gap-4">{todo.map((d) => <li key={d.id}><Run d={d} onDeliver={() => setDone(d)} onFail={() => setFailing(d)} /></li>)}</ul>
          )}
          {finished.length > 0 && (
            <section aria-label="Terminées aujourd'hui" className="flex flex-col gap-2">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Terminées aujourd'hui</h2>
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                {finished.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span><span className="font-mono font-semibold">n°{d.order.number}</span> · {d.neighborhood}{d.failReason && <span className="block text-[13px] text-muted-foreground">{d.failReason}</span>}</span>
                    <DeliveryStatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <DeliverDialog d={done} onClose={() => setDone(null)} />
      <FailDialog d={failing} onClose={() => setFailing(null)} />
    </div>
  );
}

function Run({ d, onDeliver, onFail }: { d: Delivery; onDeliver: () => void; onFail: () => void }) {
  const t = useTenant();
  const apply = useApplyDelivery();
  const pickup = useMutation({
    mutationFn: () => t.api.delivery.pickup(d.id),
    onSuccess: (r) => { apply(r); toast.success("C'est parti : le client est prévenu par SMS"); },
    onError: (e) => toastError(e),
  });
  const ready = d.order.status === "READY" || d.order.status === "DELIVERED";
  const onWay = d.status === "ON_THE_WAY";
  return (
    <article className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm", onWay ? "border-[var(--tone-blue-dot)]" : "border-border")} data-testid="run" data-status={d.status}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-xl font-semibold">n°{d.order.number}</span>
          <span className="text-[15px] font-medium">{d.order.customerName}</span>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <DeliveryStatusBadge status={d.status} />
          {!onWay && (ready ? <Badge tone="green" dot>Prête</Badge> : <Badge tone="amber" dot><Clock className="size-3" /> En préparation</Badge>)}
        </div>
      </header>
      <DeliveryAddress d={d} />
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="secondary" size="lg" className="h-12"><a href={telLink(d.phone)}><Phone /> Appeler</a></Button>
        <Button asChild variant="secondary" size="lg" className="h-12"><a href={mapsLink(d)} target="_blank" rel="noreferrer"><Navigation /> Itinéraire</a></Button>
      </div>
      <p className="line-clamp-3 text-[13px] text-muted-foreground">{d.order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
      <div className={cn("flex items-center justify-between rounded-lg px-4 py-3", d.order.remaining > 0 ? "bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]" : "bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]")}>
        <span className="text-sm font-medium">{d.order.remaining > 0 ? "À encaisser" : "Déjà réglée"}</span>
        <span className="font-mono text-xl font-semibold tabular-nums">{d.order.remaining > 0 ? formatFcfa(d.order.remaining) : formatFcfa(0)}</span>
      </div>
      {d.eta && <p className="text-[13px] text-muted-foreground">Arrivée estimée à <span className="font-mono">{formatTime(d.eta)}</span></p>}
      {onWay ? (
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" className="h-14 text-base" onClick={onDeliver}><PackageCheck className="!size-5" /> Livré{d.order.remaining > 0 ? ` · encaisser ${formatFcfa(d.order.remaining)}` : ""}</Button>
          <Button variant="ghost" size="lg" className="h-12" onClick={onFail}><CircleX /> Impossible de livrer</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" className="h-14 text-base" disabled={!ready} loading={pickup.isPending} onClick={() => pickup.mutate()}><Bike className="!size-5" /> Je l'ai récupérée, je pars</Button>
          {!ready && <p className="text-center text-[13px] text-muted-foreground">La cuisine prépare la commande : ce bouton s'active dès qu'elle est prête.</p>}
        </div>
      )}
    </article>
  );
}

function DeliverDialog({ d, onClose }: { d: Delivery | null; onClose: () => void }) {
  const t = useTenant();
  const apply = useApplyDelivery();
  const [method, setMethod] = React.useState<DeliveryCollectMethod>("CASH");
  const [reference, setReference] = React.useState("");
  const [tendered, setTendered] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setMethod("CASH"); setReference(""); setTendered(""); setError(null); }, [d?.id]);
  const due = d?.order.remaining ?? 0;
  const change = method === "CASH" && tendered ? Number(tendered) - due : null;
  const deliver = useMutation({
    mutationFn: () => {
      const parsed = completeDeliverySchema.safeParse(due > 0 ? { method, reference: method === "CASH" ? undefined : reference, tendered: method === "CASH" && tendered ? Number(tendered) : undefined } : {});
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Saisie invalide"); return Promise.reject(new Error("invalid")); }
      if (method === "CASH" && due > 0 && tendered && Number(tendered) < due) { setError("La somme remise est inférieure au montant à payer"); return Promise.reject(new Error("invalid")); }
      setError(null);
      return t.api.delivery.deliver(d!.id, parsed.data);
    },
    onSuccess: (r) => { apply(r); toast.success(`Commande n°${r.order.number} livrée`); onClose(); },
    onError: (e) => { if (!(e instanceof Error && e.message === "invalid")) toastError(e); },
  });
  return (
    <Dialog open={!!d} onOpenChange={(o) => !o && onClose()} title={due > 0 ? `Encaisser ${formatFcfa(due)}` : "Confirmer la remise"}
      description={due > 0 ? "Le client règle à la livraison. La somme sera rapprochée en caisse à votre retour." : "La commande est déjà réglée : remettez-la au client."}
      footer={<><Button variant="ghost" onClick={onClose}>Retour</Button><Button variant="primary" size="lg" loading={deliver.isPending} onClick={() => deliver.mutate()}>{due > 0 ? "Encaisser et marquer livré" : "Marquer livré"}</Button></>}>
      {due > 0 && (
        <div className="flex flex-col gap-4">
          <Segmented ariaLabel="Moyen de paiement" value={method} onChange={setMethod}
            options={(["CASH", "FLOOZ", "TMONEY"] as const).map((m) => ({ value: m, label: ORDER_PAYMENT_METHOD_LABEL[m]!, icon: m === "CASH" ? <Banknote /> : <Smartphone /> }))} />
          {method === "CASH" ? (
            <Field label="Somme remise par le client" hint={change !== null ? (change >= 0 ? `Monnaie à rendre : ${formatFcfa(change)}` : `Il manque ${formatFcfa(-change)}`) : "Facultatif : pour calculer la monnaie."}>
              <Input inputMode="numeric" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/\D/g, ""))} className="h-12 font-mono text-lg" />
            </Field>
          ) : (
            <Field label="Référence de la transaction" required hint="Le code reçu par SMS après le paiement.">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="h-12 font-mono" autoCapitalize="characters" />
            </Field>
          )}
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

function FailDialog({ d, onClose }: { d: Delivery | null; onClose: () => void }) {
  const t = useTenant();
  const apply = useApplyDelivery();
  const [reason, setReason] = React.useState("");
  React.useEffect(() => setReason(""), [d?.id]);
  const fail = useMutation({
    mutationFn: () => t.api.delivery.fail(d!.id, reason.trim()),
    onSuccess: (r) => { apply(r); toast.message(`Commande n°${r.order.number} : échec signalé`, { description: "La salle va la reprendre." }); onClose(); },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open={!!d} onOpenChange={(o) => !o && onClose()} title="Impossible de livrer" description="Indiquez pourquoi : la salle sera prévenue tout de suite."
      footer={<><Button variant="ghost" onClick={onClose}>Retour</Button><Button variant="primary" disabled={reason.trim().length < 3} loading={fail.isPending} onClick={() => fail.mutate()}>Signaler l'échec</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">{FAIL_REASONS.map((r) => <Button key={r} type="button" variant={reason === r ? "primary" : "secondary"} size="sm" onClick={() => setReason(r)}>{r}</Button>)}</div>
        <Field label="Motif" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="min-h-[72px]" /></Field>
      </div>
    </Dialog>
  );
}
