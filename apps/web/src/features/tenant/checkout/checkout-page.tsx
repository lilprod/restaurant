import type { Order, OrderPaymentMethod, OrderPaymentResult } from "@restaurant/api-client";
import { orderPaymentSchema } from "@restaurant/validation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Banknote, CheckCircle2, ChevronRight, CreditCard, Printer, Smartphone, Users, Wallet } from "lucide-react";
import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL, ORDER_PAYMENT_METHODS } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { useApplyOrder, useOperations, useTenant } from "../hooks";
import { BillSummary, ItemDetails, orderPlace, PaymentsList } from "../orders/order-bits";
import { useOrder } from "../orders/order-detail-page";
import { changeDue, equalParts, payableItems, quickTenders, splitByItems, tipFromPercent } from "./payment-math";

type Mode = "rest" | "equal" | "items";
const METHOD_ICON: Record<string, React.ReactNode> = { CASH: <Banknote />, CARD: <CreditCard />, FLOOZ: <Smartphone />, TMONEY: <Smartphone />, OTHER: <Wallet /> };

export function CheckoutPage() {
  const { id } = useParams();
  const to = useSpacePath();
  const ops = useOperations();
  const q = useOrder(id);
  const o = q.data;
  const [done, setDone] = React.useState<(OrderPaymentResult & { method: OrderPaymentMethod; amount: number; tip: number }) | null>(null);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!o) return <div className="flex flex-col gap-6"><Skeleton className="h-9 w-80" /><div className="grid gap-6 lg:grid-cols-5"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96 lg:col-span-3" /></div></div>;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Fil d'Ariane" className="-mb-2 flex flex-wrap items-center gap-1 text-[13px] text-muted-foreground">
        <Link to={to("/commandes")} className="inline-flex min-h-11 items-center gap-1 hover:text-foreground sm:min-h-0"><ArrowLeft className="size-3.5" /> Commandes</Link>
        <ChevronRight className="size-3.5 text-faint" /><Link to={to(`/commandes/${o.id}`)} className="hover:text-foreground">n°{o.number}</Link>
        <ChevronRight className="size-3.5 text-faint" /><span className="text-foreground">Encaisser</span>
      </nav>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">Encaisser · <span className="font-mono">n°{o.number}</span></h1>
          <p className="text-sm text-muted-foreground">{orderPlace(o)}</p>
        </div>
        <div className="flex flex-col sm:items-end">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Reste à payer</span>
          <span className={cn("font-mono text-3xl font-semibold tracking-tight tabular-nums", o.remaining === 0 && "text-success")}>{formatFcfa(o.remaining)}</span>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <div className="border-b border-border p-4 sm:px-5"><h2 className="text-[15px] font-semibold tracking-tight">Addition</h2></div>
          <ul className="divide-y divide-border">
            {o.items.filter((i) => i.status !== "CANCELLED").map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm"><span className="font-mono tabular-nums">{i.quantity}×</span> {i.name}</p>
                  <ItemDetails item={{ options: i.options, instructions: null }} />
                  {i.paidQuantity > 0 && <p className="text-xs text-success">{i.paidQuantity === i.quantity ? "Encaissé" : `${i.paidQuantity}/${i.quantity} encaissé`}</p>}
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums">{formatFcfa(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-4 sm:px-5">
            <BillSummary order={o} serviceChargePercent={ops.serviceChargePercent} defaultVatRate={ops.defaultVatRate} />
          </div>
          <div className="border-t border-border p-4 sm:px-5">
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Paiements</h3>
            <PaymentsList order={o} />
          </div>
        </Card>

        <div className="order-first lg:order-none lg:col-span-3">
          {done ? <SuccessCard result={done} onNext={() => setDone(null)} /> : o.cancelledAt ? (
            <Callout tone="danger" title="Commande annulée">Aucun encaissement n'est possible.</Callout>
          ) : o.remaining <= 0 ? (
            <Card className="flex flex-col items-center gap-3 p-8 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <p className="text-lg font-semibold">Commande réglée</p>
              <p className="text-sm text-muted-foreground">{o.closedAt ? "Elle est clôturée." : "Elle sera clôturée dès que tous les plats seront servis."}</p>
              <div className="flex gap-2"><Button asChild variant="secondary"><Link to={to(`/commandes/${o.id}/ticket`)}><Printer /> Ticket</Link></Button><Button asChild variant="primary"><Link to={to(`/commandes/${o.id}`)}>Voir la commande</Link></Button></div>
            </Card>
          ) : <PaymentPanel order={o} onPaid={setDone} />}
        </div>
      </div>
    </div>
  );
}

function PaymentPanel({ order, onPaid }: { order: Order; onPaid: (r: OrderPaymentResult & { method: OrderPaymentMethod; amount: number; tip: number }) => void }) {
  const t = useTenant();
  const to = useSpacePath();
  const ops = useOperations();
  const apply = useApplyOrder();
  const register = useQuery({ queryKey: [...tenantKeys.register(t.root), "current"], queryFn: t.api.register.current, staleTime: 30_000 });
  const [mode, setMode] = React.useState<Mode>("rest");
  const [people, setPeople] = React.useState(2);
  const [paidParts, setPaidParts] = React.useState(0);
  const [picked, setPicked] = React.useState<Record<string, number>>({});
  const [custom, setCustom] = React.useState<number | null>(null);
  const [method, setMethod] = React.useState<OrderPaymentMethod>("CASH");
  const [reference, setReference] = React.useState("");
  const [tipPct, setTipPct] = React.useState<string>("0");
  const [tipCustom, setTipCustom] = React.useState<number | null>(null);
  const [tendered, setTendered] = React.useState<number | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const parts = equalParts(order.remaining, people, paidParts);
  const split = splitByItems(order, picked);
  const amount = mode === "rest" ? Math.min(order.remaining, custom ?? order.remaining) : mode === "equal" ? parts[0] ?? 0 : split.amount;
  const tip = !ops.tipsEnabled ? 0 : tipPct === "custom" ? tipCustom ?? 0 : tipFromPercent(amount, Number(tipPct));
  const due = amount + tip;
  const change = tendered === null ? null : changeDue(tendered, amount, tip);

  React.useEffect(() => { setTendered(null); }, [amount, tip, method]);
  React.useEffect(() => { setErrors({}); }, [method, mode]);

  const pay = useMutation({
    mutationFn: (body: Parameters<typeof t.api.orders.pay>[1]) => t.api.orders.pay(order.id, body),
    onSuccess: (r, body) => {
      apply(r.order);
      if (mode === "equal") setPaidParts((n) => n + 1);
      setPicked({}); setCustom(null); setReference(""); setTendered(null); setTipPct("0"); setTipCustom(null);
      onPaid({ ...r, method: body.method, amount: body.amount, tip: body.tip ?? 0 });
    },
    onError: (e) => setErrors({ form: errorMessage(e) }),
  });

  const submit = () => {
    const parsed = orderPaymentSchema.safeParse({
      method, amount, tip,
      tendered: method === "CASH" ? tendered ?? undefined : undefined,
      reference: reference.trim() || undefined,
      allocations: mode === "items" ? split.allocations : undefined,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? "form")] ??= i.path[0] === "amount" ? "Choisissez un montant à encaisser" : i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    pay.mutate(parsed.data);
  };

  const presets = ops.tipPresets ?? [];
  return (
    <Card className="flex flex-col">
      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {register.data && !register.data.open && (
          <Callout tone="warning" title="Aucune caisse ouverte">
            Le paiement sera enregistré sans être rattaché à une session de caisse.{t.isManager && <> <Link to={to("/caisse")}>Ouvrir la caisse</Link></>}
          </Callout>
        )}

        <Field label="Mode de règlement">
          <Segmented<Mode> ariaLabel="Mode de règlement" value={mode} onChange={setMode} className="sm:w-full"
            options={[{ value: "rest", label: "Le reste" }, { value: "equal", label: "Partage égal", icon: <Users /> }, { value: "items", label: "Par article" }]} />
        </Field>

        {mode === "rest" && (
          <Field label="Montant encaissé" hint="Modifiez-le pour un paiement partiel.">
            <MoneyInput value={custom ?? order.remaining} onValueChange={(v) => setCustom(v)} className="h-12 text-lg sm:h-11" />
          </Field>
        )}

        {mode === "equal" && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Nombre de personnes</span>
              <Stepper label="personnes" value={people} min={2} max={20} onChange={(v) => { setPeople(Math.max(2, Math.max(v, paidParts + 1))); }} />
            </div>
            <ol className="flex flex-wrap gap-2" aria-label="Parts">
              {Array.from({ length: paidParts }, (_, i) => (
                <li key={`p${i}`} className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[13px] text-muted-foreground"><CheckCircle2 className="size-3.5 text-success" /> Part {i + 1}</li>
              ))}
              {parts.map((p, i) => (
                <li key={`r${i}`} className={cn("flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[13px]", i === 0 ? "border-brand-ink bg-brand-tint font-medium" : "border-border bg-background")}>
                  Part {paidParts + i + 1} <span className="font-mono tabular-nums">{formatFcfa(p)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {mode === "items" && (
          <div className="flex flex-col rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {payableItems(order).map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{i.name}</p>
                    <p className="font-mono text-xs text-muted-foreground tabular-nums">{formatFcfa(i.unitPrice + i.optionsExtra)} · reste {i.left}</p>
                  </div>
                  <Stepper label={i.name} value={picked[i.id] ?? 0} min={0} max={i.left} onChange={(v) => setPicked((p) => ({ ...p, [i.id]: Math.max(0, Math.min(i.left, v)) }))} />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-border bg-subtle px-3 py-2 text-[13px] text-muted-foreground">
              <span>Articles <span className="font-mono">{formatFcfa(split.itemsAmount)}</span>{split.serviceShare > 0 && <> + service <span className="font-mono">{formatFcfa(split.serviceShare)}</span></>}</span>
              <Button variant="ghost" size="sm" onClick={() => setPicked(Object.fromEntries(payableItems(order).map((i) => [i.id, i.left])))}>Tout sélectionner</Button>
            </div>
          </div>
        )}
        {errors.amount && <p role="alert" className="-mt-3 text-[12.5px] text-danger">{errors.amount}</p>}

        <Field label="Moyen de paiement">
          <Segmented<OrderPaymentMethod> ariaLabel="Moyen de paiement" value={method} onChange={setMethod} className="sm:w-full [&_button]:px-1.5 sm:[&_button]:px-3"
            options={ORDER_PAYMENT_METHODS.map((m) => ({ value: m, label: ORDER_PAYMENT_METHOD_LABEL[m]!, icon: <span className="hidden sm:inline-flex">{METHOD_ICON[m]}</span> }))} />
        </Field>

        {method !== "CASH" && (
          <Field label={method === "FLOOZ" || method === "TMONEY" ? "Référence de la transaction" : "Référence (facultatif)"} required={method === "FLOOZ" || method === "TMONEY"} error={errors.reference}
            hint={method === "FLOOZ" || method === "TMONEY" ? "Numéro reçu par SMS après le transfert." : undefined}>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="font-mono" autoComplete="off" />
          </Field>
        )}

        {ops.tipsEnabled && (
          <Field label="Pourboire">
            <div className="flex flex-col gap-2">
              <Segmented ariaLabel="Pourboire" size="sm" value={tipPct} onChange={setTipPct} className="sm:w-full"
                options={[{ value: "0", label: "Aucun" }, ...presets.map((p) => ({ value: String(p), label: `${p} %` })), { value: "custom", label: "Autre" }]} />
              {tipPct === "custom" && <MoneyInput aria-label="Montant du pourboire" value={tipCustom} onValueChange={setTipCustom} />}
            </div>
          </Field>
        )}

        {method === "CASH" && (
          <div className="flex flex-col gap-3">
            <Field label="Somme remise par le client" error={errors.tendered}>
              <MoneyInput value={tendered} onValueChange={setTendered} className="h-12 text-lg sm:h-11" placeholder="0" />
            </Field>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {quickTenders(due).map((v, i) => (
                <Button key={v} variant={tendered === v ? "primary" : "secondary"} className="h-12 font-mono tabular-nums" onClick={() => setTendered(v)}>
                  {i === 0 ? "Exact" : formatFcfa(v)}
                </Button>
              ))}
            </div>
            <div aria-live="polite" className={cn("flex items-center justify-between gap-3 rounded-lg border px-4 py-3",
              change === null ? "border-border bg-subtle" : change >= 0 ? "border-[color-mix(in_oklab,var(--tone-green-dot)_40%,var(--border))] bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]" : "border-[color-mix(in_oklab,var(--tone-red-dot)_40%,var(--border))] bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]")}>
              <span className="text-sm font-medium">{change !== null && change < 0 ? "Il manque" : "Monnaie à rendre"}</span>
              <span className="font-mono text-3xl font-semibold tabular-nums">{change === null ? "—" : formatFcfa(Math.abs(change))}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-b-lg border-t border-border bg-subtle p-4 sm:p-5">
        {errors.form && <Callout tone="danger">{errors.form}</Callout>}
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">À encaisser</dt><dd className="font-mono tabular-nums">{formatFcfa(amount)}</dd></div>
          {tip > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Pourboire</dt><dd className="font-mono tabular-nums">{formatFcfa(tip)}</dd></div>}
        </dl>
        <Button variant="primary" size="lg" className="h-14 text-base" loading={pay.isPending} disabled={amount <= 0} onClick={submit}>
          Encaisser <span className="font-mono tabular-nums">{formatFcfa(due)}</span>{mode === "equal" && parts.length > 0 && <span className="font-normal opacity-80">· part {paidParts + 1}/{people}</span>}
        </Button>
      </div>
    </Card>
  );
}

function SuccessCard({ result, onNext }: { result: OrderPaymentResult & { method: OrderPaymentMethod; amount: number; tip: number }; onNext: () => void }) {
  const to = useSpacePath();
  const o = result.order;
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center sm:p-8" role="status">
      <span className="flex size-14 items-center justify-center rounded-full bg-[var(--tone-green-bg)]"><CheckCircle2 className="size-8 text-success" /></span>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold">Paiement enregistré</p>
        <p className="text-sm text-muted-foreground">
          {ORDER_PAYMENT_METHOD_LABEL[result.method]} · <span className="font-mono">{formatFcfa(result.amount)}</span>{result.tip > 0 && <> + pourboire <span className="font-mono">{formatFcfa(result.tip)}</span></>}
        </p>
      </div>
      {result.change !== null && (
        <div className="w-full max-w-sm rounded-xl border border-[color-mix(in_oklab,var(--tone-green-dot)_40%,var(--border))] bg-[var(--tone-green-bg)] px-6 py-5 text-[var(--tone-green-fg)]">
          <p className="text-sm font-medium uppercase tracking-wide">Monnaie à rendre</p>
          <p className="font-mono text-5xl font-semibold tracking-tight tabular-nums">{formatFcfa(result.change)}</p>
        </div>
      )}
      <p className="text-sm">
        {o.closedAt ? <>Commande n°{o.number} réglée et clôturée{o.table ? " · la table est libérée" : ""}.</>
          : o.remaining > 0 ? <>Reste à payer : <span className="font-mono font-semibold">{formatFcfa(o.remaining)}</span></>
          : <>Commande réglée : elle sera clôturée une fois tous les plats servis.</>}
      </p>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <Button asChild variant="secondary"><Link to={to(`/commandes/${o.id}/ticket`)}><Printer /> Imprimer le ticket</Link></Button>
        {o.remaining > 0 ? <Button variant="primary" onClick={onNext}>Encaisser la suite</Button> : <Button asChild variant="primary"><Link to={to("/")}>Retour au service</Link></Button>}
      </div>
    </Card>
  );
}
