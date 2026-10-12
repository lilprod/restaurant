import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateShort, formatFcfa, formatTime } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL, ORDER_TYPE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";

/** Montant sans l'unité (le ticket est étroit) : 12 500 */
const n = (v: number) => new Intl.NumberFormat("fr-FR").format(v);

/** Ticket de caisse (format thermique 80 mm), imprimable depuis le navigateur. */
export function TicketPage() {
  const { id } = useParams();
  const t = useTenant();
  const to = useSpacePath();
  const q = useQuery({ queryKey: tenantKeys.receipt(t.root, id ?? ""), queryFn: () => t.api.orders.receipt(id!), enabled: !!id });
  const r = q.data;

  return (
    <div className="flex flex-col items-center gap-6">
      <style>{"@media print { @page { size: 80mm auto; margin: 3mm; } html, body { background: #fff !important; } #contenu { padding: 0 !important; max-width: none !important; } }"}</style>
      <div className="no-print flex w-full max-w-md items-center justify-between gap-2">
        <Button asChild variant="ghost"><Link to={to(`/commandes/${id}`)}><ArrowLeft /> Commande</Link></Button>
        <Button variant="primary" onClick={() => window.print()} disabled={!r}><Printer /> Imprimer</Button>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} className="w-full max-w-md" /> : !r ? <Skeleton className="h-[520px] w-[302px] rounded-md" /> : (
        <article aria-label="Ticket de caisse"
          className="print-area w-[80mm] max-w-full rounded-md border border-border bg-card px-4 py-5 font-mono text-[12px] leading-[1.45] text-card-foreground shadow-md print:w-full print:rounded-none print:border-0 print:p-0 print:text-black">
          <header className="flex flex-col items-center gap-0.5 text-center">
            {r.restaurant.logoUrl && <img src={r.restaurant.logoUrl} alt="" className="mb-2 max-h-14 max-w-[60%] object-contain grayscale" />}
            <p className="text-[14px] font-bold uppercase">{r.restaurant.name}</p>
            {r.restaurant.legalName && r.restaurant.legalName !== r.restaurant.name && <p>{r.restaurant.legalName}</p>}
            {r.restaurant.address && <p>{r.restaurant.address}</p>}
            {r.restaurant.phone && <p>Tél. {r.restaurant.phone}</p>}
            {r.restaurant.taxId && <p>NIF : {r.restaurant.taxId}</p>}
            {r.restaurant.registrationNumber && <p>RCCM : {r.restaurant.registrationNumber}</p>}
            {r.restaurant.headerText && <p className="mt-1 whitespace-pre-line">{r.restaurant.headerText}</p>}
          </header>
          <Rule />
          <div className="flex justify-between"><span className="font-bold">Commande n°{r.order.number}</span><span>{formatDateShort(r.order.createdAt)} {formatTime(r.order.createdAt)}</span></div>
          <p>{r.order.table ? `Table ${r.order.table.label}` : ORDER_TYPE_LABEL[r.order.type]}{r.order.customerName ? ` · ${r.order.customerName}` : ""}</p>
          {r.order.waiter && <p>Serveur : {r.order.waiter.firstName}</p>}
          <Rule />
          <ul className="flex flex-col gap-1">
            {r.order.items.filter((i) => i.status !== "CANCELLED").map((i) => (
              <li key={i.id}>
                <div className="flex justify-between gap-2"><span>{i.quantity} × {i.name}</span><span className="shrink-0 tabular-nums">{n(i.lineTotal)}</span></div>
                {i.quantity > 1 && <p className="pl-3 text-[11px]">à {n(i.unitPrice + i.optionsExtra)}</p>}
                {i.options.map((o) => <p key={o.optionId} className="pl-3 text-[11px]">+ {o.name}{o.extra ? ` (${n(o.extra)})` : ""}</p>)}
              </li>
            ))}
          </ul>
          <Rule />
          <Row label="Sous-total" value={n(r.order.subtotal)} />
          {r.order.serviceCharge > 0 && <Row label="Service" value={n(r.order.serviceCharge)} />}
          <div className="my-1 flex justify-between text-[15px] font-bold"><span>TOTAL TTC</span><span className="tabular-nums">{formatFcfa(r.order.total)}</span></div>
          {r.vatBreakdown.length > 0 && (
            <table className="mt-1 w-full text-[11px]">
              <thead><tr><th className="text-left font-normal">TVA</th><th className="text-right font-normal">Base HT</th><th className="text-right font-normal">Montant</th></tr></thead>
              <tbody>{r.vatBreakdown.map((v) => <tr key={v.rate}><td>{v.rate} %</td><td className="text-right tabular-nums">{n(v.base)}</td><td className="text-right tabular-nums">{n(v.vat)}</td></tr>)}</tbody>
            </table>
          )}
          {r.order.payments.some((p) => p.status === "PAID") && (
            <>
              <Rule />
              {r.order.payments.filter((p) => p.status === "PAID").map((p) => (
                <div key={p.id}>
                  <Row label={`${ORDER_PAYMENT_METHOD_LABEL[p.method]}${p.reference ? ` ${p.reference}` : ""}`} value={n(p.amount)} />
                  {p.tip > 0 && <Row label="  Pourboire" value={n(p.tip)} />}
                  {p.tendered != null && <Row label="  Remis" value={n(p.tendered)} />}
                  {p.change != null && p.change > 0 && <Row label="  Rendu" value={n(p.change)} />}
                </div>
              ))}
              {r.order.remaining > 0 && <Row label="Reste à payer" value={n(r.order.remaining)} bold />}
            </>
          )}
          <Rule />
          <footer className="flex flex-col items-center gap-0.5 text-center">
            <p className="whitespace-pre-line">{r.restaurant.footerText || "Merci de votre visite !"}</p>
            <p className="text-[10px] opacity-70">Montants en {r.currency === "XOF" ? "FCFA" : r.currency} · imprimé le {formatDateShort(r.printedAt)} à {formatTime(r.printedAt)}</p>
          </footer>
        </article>
      )}
    </div>
  );
}

const Rule = () => <hr className="my-2 border-0 border-t border-dashed border-current opacity-40" />;
const Row = ({ label, value, bold }: { label: string; value: string; bold?: boolean }) => (
  <div className={bold ? "flex justify-between font-bold" : "flex justify-between"}><span className="whitespace-pre">{label}</span><span className="tabular-nums">{value}</span></div>
);
