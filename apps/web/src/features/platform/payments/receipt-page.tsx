import type { CompanyInput } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, FileText, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand-mark";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDate, formatDateTime, formatFcfa } from "@/lib/format";
import { BILLING_CYCLE_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/labels";
import { papi, pk, useCanWrite } from "../hooks";

/** Reçu imprimable (la version PDF arrivera avec le module rapports). */
export function ReceiptPage() {
  const { id = "" } = useParams();
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: pk.payment(id), queryFn: () => papi.payments.get(id) });
  const company = useQuery({ queryKey: [...pk.settings, "company"], queryFn: () => papi.settings.get("company") as Promise<CompanyInput> });
  const voidPay = useMutation({
    mutationFn: (reason: string) => papi.payments.void(id, reason),
    onSuccess: () => {
      toast.success("Paiement annulé", { description: "La période a été restituée." });
      void qc.invalidateQueries({ queryKey: pk.payment(id) });
      void qc.invalidateQueries({ queryKey: pk.paymentsAll });
      void qc.invalidateQueries({ queryKey: pk.dashboard });
      if (q.data) { void qc.invalidateQueries({ queryKey: pk.tenant(q.data.tenantId) }); void qc.invalidateQueries({ queryKey: pk.tenantSubs(q.data.tenantId) }); }
    },
    onError: (e) => toastError(e),
  });

  if (q.isLoading) return <div className="mx-auto flex max-w-2xl flex-col gap-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-[520px]" /></div>;
  if (q.isError || !q.data) return <EmptyState icon={<FileText />} title="Reçu introuvable" description={errorMessage(q.error)} action={<Button asChild variant="secondary"><Link to="/admin/paiements">Retour aux paiements</Link></Button>} />;

  const p = q.data;
  const c = company.data;
  const voided = p.status === "VOIDED";
  const months = Math.max(1, Math.round((new Date(p.periodEnd).getTime() - new Date(p.periodStart).getTime()) / (30.44 * 86_400_000)));
  const qty = p.billingCycle === "YEARLY" ? Math.max(1, Math.round(months / 12)) : months;
  const address = c?.address ? [c.address.street, c.address.city, c.address.country].filter(Boolean).join(", ") : "";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to="/admin/paiements" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground sm:min-h-0"><ArrowLeft className="size-3.5" /> Paiements</Link>
        <div className="flex gap-2">
          {canWrite && !voided && (
            <Button variant="danger-ghost" size="sm" onClick={() => confirm({
              title: `Annuler le paiement ${p.receiptNumber} ?`,
              description: `La période ${formatDate(p.periodStart)} → ${formatDate(p.periodEnd)} sera restituée. Seul le dernier paiement d'une licence peut être annulé.`,
              confirmLabel: "Annuler le paiement",
              reason: { label: "Motif de l'annulation", placeholder: "Erreur de saisie…" },
              onConfirm: (reason) => voidPay.mutateAsync(reason!),
            })}><Ban /> Annuler le paiement</Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer /> Imprimer</Button>
        </div>
      </div>

      {voided && (
        <Callout tone="danger" title={`Paiement annulé le ${formatDateTime(p.voidedAt)}`} className="no-print">Motif : {p.voidReason}</Callout>
      )}

      <article className="print-area relative overflow-hidden rounded-xl border border-border bg-card shadow-md" aria-label={`Reçu ${p.receiptNumber}`}>
        {voided && (
          <span aria-hidden className="pointer-events-none absolute right-[-60px] top-10 rotate-[30deg] border-y-2 border-danger px-24 py-1 text-sm font-bold uppercase tracking-[0.3em] text-danger opacity-70">Annulé</span>
        )}
        <header className="flex flex-col gap-6 border-b border-dashed border-border-strong p-6 sm:flex-row sm:justify-between sm:p-8">
          <div className="flex flex-col gap-2">
            <BrandMark showName size={28} />
            <div className="text-xs leading-relaxed text-muted-foreground">
              {c?.legalName && <p>{c.legalName}</p>}
              {address && <p>{address}</p>}
              {(c?.supportEmail || c?.email) && <p>{c.supportEmail ?? c.email}</p>}
              {(c?.taxId || c?.registrationNumber) && <p className="font-mono">{c.taxId && `NIF ${c.taxId}`}{c.taxId && c.registrationNumber && " · "}{c.registrationNumber && `RCCM ${c.registrationNumber}`}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-1 sm:items-end sm:text-right">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Reçu de paiement</span>
            <span className="flex items-center font-mono text-lg font-semibold tracking-tight">{p.receiptNumber}<CopyButton value={p.receiptNumber} className="no-print size-8" /></span>
            <span className="text-[13px] text-muted-foreground">Émis le <span className="font-mono">{formatDate(p.createdAt)}</span></span>
            <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABEL} className="mt-1 self-start sm:self-end" />
          </div>
        </header>

        <section className="grid gap-6 p-6 sm:grid-cols-2 sm:p-8">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Reçu de</span>
            <span className="font-medium">{p.tenant.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{p.tenant.slug}</span>
            <span className="text-[13px] text-muted-foreground">{p.tenant.email}</span>
          </div>
          <div className="flex flex-col gap-1 sm:items-end sm:text-right">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Paiement</span>
            <span>{PAYMENT_METHOD_LABEL[p.method]} · <span className="font-mono">{formatDate(p.paidAt)}</span></span>
            {p.reference && <span className="font-mono text-[13px] text-muted-foreground">Réf. {p.reference}</span>}
          </div>
        </section>

        <section className="px-6 sm:px-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <th className="pb-2 font-medium">Désignation</th>
                <th className="pb-2 text-right font-medium">Montant</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="py-4 pr-4">
                  <p className="font-medium">Licence {p.subscription.plan.name} — {BILLING_CYCLE_LABEL[p.billingCycle]?.toLowerCase()} × {qty}</p>
                  <p className="font-mono text-xs text-muted-foreground">Du {formatDate(p.periodStart)} au {formatDate(p.periodEnd)}</p>
                  {p.notes && <p className="mt-1 text-xs text-muted-foreground">{p.notes}</p>}
                </td>
                <td className={cn("py-4 text-right font-mono tabular", voided && "line-through")}>{formatFcfa(p.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-4 text-right text-[13px] text-muted-foreground">Total payé</td>
                <td className={cn("pt-4 text-right font-mono text-xl font-semibold tabular", voided && "text-muted-foreground line-through")}>{formatFcfa(p.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <footer className="mt-8 flex flex-col gap-1 border-t border-border bg-subtle px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-8">
          <span>Enregistré par {p.recordedBy.firstName} {p.recordedBy.lastName} · {formatDateTime(p.createdAt)}</span>
          <span>Montants en FCFA ({p.currency})</span>
        </footer>
      </article>
    </div>
  );
}
