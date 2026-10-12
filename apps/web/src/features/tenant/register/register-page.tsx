import type { RegisterSession } from "@restaurant/api-client";
import { closeRegisterSchema, openRegisterSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, LockOpen, Lock } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatFcfa } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL, ORDER_PAYMENT_METHODS } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";

/** Écart de caisse : vert si juste, ambre si excédent, rouge si manque. */
export function differenceTone(diff: number): "green" | "amber" | "red" {
  return diff === 0 ? "green" : diff > 0 ? "amber" : "red";
}
const TONE_BOX = {
  green: "border-[color-mix(in_oklab,var(--tone-green-dot)_40%,var(--border))] bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]",
  amber: "border-[color-mix(in_oklab,var(--tone-amber-dot)_40%,var(--border))] bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]",
  red: "border-[color-mix(in_oklab,var(--tone-red-dot)_40%,var(--border))] bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]",
} as const;
const diffLabel = (d: number) => (d === 0 ? "Caisse juste" : d > 0 ? "Excédent" : "Manque");
const signed = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatFcfa(Math.abs(d))}`;

export function RegisterPage() {
  const t = useTenant();
  const current = useQuery({ queryKey: [...tenantKeys.register(t.root), "current"], queryFn: t.api.register.current, refetchInterval: 60_000 });
  const history = useQuery({ queryKey: [...tenantKeys.register(t.root), "sessions"], queryFn: t.api.register.sessions, enabled: t.isManager });
  const [dialog, setDialog] = React.useState<"open" | "close" | null>(null);
  const c = current.data;

  const columns: Column<RegisterSession>[] = [
    { key: "opened", header: "Ouverte", cell: (s) => <span className="font-mono text-[13px]">{formatDateTime(s.openedAt)}</span> },
    { key: "closed", header: "Clôturée", cell: (s) => s.closedAt ? <span className="font-mono text-[13px]">{formatDateTime(s.closedAt)}</span> : <Badge tone="green" dot>En cours</Badge> },
    { key: "opening", header: "Fond", align: "right", cell: (s) => <span className="font-mono tabular-nums">{formatFcfa(s.opening)}</span> },
    { key: "expected", header: "Attendu", align: "right", cell: (s) => <span className="font-mono tabular-nums">{s.expectedCash != null ? formatFcfa(s.expectedCash) : "—"}</span> },
    { key: "counted", header: "Compté", align: "right", cell: (s) => <span className="font-mono tabular-nums">{s.closing != null ? formatFcfa(s.closing) : "—"}</span> },
    { key: "diff", header: "Écart", align: "right", cell: (s) => s.difference == null ? "—" : <Badge tone={differenceTone(s.difference)} className="font-mono">{signed(s.difference)}</Badge> },
  ];

  return (
    <>
      <PageHeader
        title="Caisse"
        description="Fond de caisse, encaissements par moyen de paiement et espèces attendues dans le tiroir."
        actions={t.isManager && c && (c.open
          ? <Button variant="primary" onClick={() => setDialog("close")}><Lock /> Clôturer la caisse</Button>
          : <Button variant="primary" onClick={() => setDialog("open")}><LockOpen /> Ouvrir la caisse</Button>)}
      />
      {current.isError ? <ErrorState error={current.error} onRetry={() => current.refetch()} /> : !c ? (
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-40 rounded-lg" /><Skeleton className="h-40 rounded-lg lg:col-span-2" /></div>
      ) : !c.open ? (
        <Card><EmptyState icon={<Landmark />} title="Caisse fermée" description={t.isManager ? "Ouvrez la caisse avec le fond de départ : les paiements du service y seront rattachés." : "Un responsable doit ouvrir la caisse. Les paiements restent possibles mais ne sont rattachés à aucune session."}
          action={t.isManager ? <Button variant="primary" onClick={() => setDialog("open")}><LockOpen /> Ouvrir la caisse</Button> : undefined} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between"><span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Espèces attendues</span><Badge tone="green" dot>Ouverte</Badge></div>
            <span className="font-mono text-[32px] font-semibold leading-none tracking-tight tabular-nums"><AnimatedNumber value={c.expectedCash} format={formatFcfa} /></span>
            <span className="text-[13px] text-muted-foreground">Fond <span className="font-mono text-foreground">{formatFcfa(c.session.opening)}</span> + espèces encaissées (pourboires inclus).</span>
            <span className="text-xs text-faint">Ouverte le {formatDateTime(c.session.openedAt)}</span>
          </Card>
          <Card className="lg:col-span-2">
            <div className="flex items-baseline justify-between gap-3 p-5 pb-3">
              <h2 className="text-[15px] font-semibold tracking-tight">Encaissements de la session</h2>
              <span className="text-[13px] text-muted-foreground"><span className="font-mono text-foreground">{formatFcfa(c.total)}</span> · {c.paymentsCount} paiement{c.paymentsCount > 1 ? "s" : ""}</span>
            </div>
            <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg border-t border-border bg-border sm:grid-cols-5">
              {ORDER_PAYMENT_METHODS.map((m) => {
                const v = c.byMethod[m];
                return (
                  <li key={m} className="flex flex-col gap-0.5 bg-card px-4 py-3">
                    <span className="text-xs text-muted-foreground">{ORDER_PAYMENT_METHOD_LABEL[m]}</span>
                    <span className="font-mono text-sm font-medium tabular-nums">{formatFcfa(v?.amount ?? 0)}</span>
                    <span className="text-[11px] text-faint">{v?.count ?? 0} paiement{(v?.count ?? 0) > 1 ? "s" : ""}{v?.tips ? ` · ${formatFcfa(v.tips)} pourb.` : ""}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}

      {t.isManager && (
        <section className="mt-8 flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold tracking-tight">Historique</h2>
          {history.isError ? <ErrorState error={history.error} onRetry={() => history.refetch()} /> : (
            <DataTable caption="Sessions de caisse" rows={history.data} loading={history.isLoading} columns={columns} rowKey={(s) => s.id}
              empty={<EmptyState icon={<Landmark />} title="Aucune session" description="Les sessions de caisse clôturées apparaîtront ici avec leur écart." />} />
          )}
        </section>
      )}

      {t.isManager && <OpenDialog open={dialog === "open"} onClose={() => setDialog(null)} />}
      {t.isManager && c?.open && <CloseDialog open={dialog === "close"} onClose={() => setDialog(null)} expected={c.expectedCash} />}
    </>
  );
}

function OpenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const [opening, setOpening] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setOpening(null); setError(null); } }, [open]);
  const run = useMutation({
    mutationFn: (v: number) => t.api.register.open(v),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: tenantKeys.register(t.root) }); toast.success("Caisse ouverte"); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const p = openRegisterSchema.safeParse({ opening: opening ?? 0 });
    if (!p.success) { setError(p.error.issues[0]?.message ?? "Montant invalide"); return; }
    run.mutate(p.data.opening);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="sm" title="Ouvrir la caisse" description="Comptez le fond de caisse (monnaie) présent dans le tiroir."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={run.isPending} onClick={() => submit()}>Ouvrir la caisse</Button></>}>
      <form onSubmit={submit} noValidate>
        <Field label="Fond de caisse" error={error ?? undefined}><MoneyInput autoFocus value={opening} onValueChange={setOpening} placeholder="0" className="h-12 text-lg sm:h-11" /></Field>
      </form>
    </Dialog>
  );
}

function CloseDialog({ open, onClose, expected }: { open: boolean; onClose: () => void; expected: number }) {
  const t = useTenant();
  const qc = useQueryClient();
  const [counted, setCounted] = React.useState<number | null>(null);
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setCounted(null); setNotes(""); setError(null); } }, [open]);
  const diff = counted === null ? null : counted - expected;
  const run = useMutation({
    mutationFn: (v: { counted: number; notes?: string }) => t.api.register.close(v),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: tenantKeys.register(t.root) });
      const d = r.session.difference ?? 0;
      toast.success("Caisse clôturée", { description: d === 0 ? "Caisse juste." : `${diffLabel(d)} de ${formatFcfa(Math.abs(d))}.` });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const p = closeRegisterSchema.safeParse({ counted: counted ?? undefined, notes });
    if (!p.success) { setError("Saisissez le montant compté dans le tiroir"); return; }
    run.mutate(p.data);
  };
  const tone = diff === null ? null : differenceTone(diff);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} size="sm" title="Clôturer la caisse" description="Comptez les espèces du tiroir : l'écart avec le montant attendu est enregistré."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={run.isPending} onClick={() => submit()}>Clôturer la caisse</Button></>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between rounded-lg bg-subtle px-4 py-3 text-sm"><span className="text-muted-foreground">Espèces attendues</span><span className="font-mono font-semibold tabular-nums">{formatFcfa(expected)}</span></div>
        <Field label="Espèces comptées" error={error ?? undefined}><MoneyInput autoFocus value={counted} onValueChange={setCounted} placeholder="0" className="h-12 text-lg sm:h-11" /></Field>
        <div aria-live="polite" className={cn("flex items-center justify-between rounded-lg border px-4 py-3",
          tone === null ? "border-border" : TONE_BOX[tone])}>
          <span className="text-sm font-medium">{diff === null ? "Écart" : diffLabel(diff)}</span>
          <span className="font-mono text-2xl font-semibold tabular-nums">{diff === null ? "—" : signed(diff)}</span>
        </div>
        {diff !== null && diff !== 0 && <Callout tone={diff < 0 ? "danger" : "warning"}>Expliquez l'écart dans la note (erreur de rendu, dépense payée en espèces…).</Callout>}
        <Field label="Note" hint="Facultatif."><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className="min-h-[64px]" /></Field>
      </form>
    </Dialog>
  );
}
