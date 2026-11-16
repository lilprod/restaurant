import type { CustomerOrder } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, ReceiptText, Star } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { formatDateShort, formatFcfa } from "@/lib/format";
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL } from "@/lib/labels";
import { orderStatusTone } from "@restaurant/ui-tokens";
import { useCustomer } from "./hooks";
import { ReviewCard, ReviewForm } from "./review-form";

const TOKEN = /([A-Za-z0-9_-]{30,100})\/?(?:[?#].*)?$/;
/** Accepte le lien complet imprimé sur le ticket ou son seul jeton. */
export const tokenFrom = (v: string) => TOKEN.exec(v.trim())?.[1] ?? null;

/** Mes commandes et mes avis : un avis par commande terminée ; rattacher une commande avec le lien du ticket. */
export function OrdersTab() {
  const c = useCustomer();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: c.key("orders"), queryFn: () => c.api.orders() });
  const [reviewing, setReviewing] = React.useState<CustomerOrder | null>(null);
  const [link, setLink] = React.useState("");
  const claim = useMutation({
    mutationFn: () => { const t = tokenFrom(link); if (!t) throw new Error("Collez le lien imprimé sur votre ticket."); return c.api.claimOrder(t); },
    onSuccess: (r) => { toast.success(`Commande n°${r.number} ajoutée`); setLink(""); void qc.invalidateQueries({ queryKey: c.key("orders") }); },
    onError: (e) => toastError(e),
  });

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => { e.preventDefault(); claim.mutate(); }} className="flex flex-col gap-3 rounded-xl border border-border bg-subtle p-4 sm:p-5">
        <Field label="Ajouter une commande" hint="Collez le lien imprimé sur votre ticket pour retrouver la commande ici et donner votre avis.">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/suivi/…" inputMode="url" autoCapitalize="off" spellCheck={false} />
        </Field>
        <Button type="submit" variant="secondary" size="lg" className="w-fit" loading={claim.isPending} disabled={!link.trim()}><Link2 /> Ajouter</Button>
      </form>

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-28 rounded-xl" /></div>
      ) : q.data.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="Aucune commande rattachée" description="Vos commandes à emporter ou sur place apparaîtront ici dès que vous les ajoutez avec le lien de votre ticket." />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((o) => (
            <li key={o.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5" data-testid="customer-order">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">Commande n°<span className="font-mono">{o.number}</span> <span className="font-normal text-muted-foreground">· {ORDER_TYPE_LABEL[o.type] ?? o.type}</span></p>
                  <p className="text-sm text-muted-foreground">{formatDateShort(o.createdAt)} · <span className="font-mono">{formatFcfa(o.total)}</span></p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</p>
                </div>
                {!o.closedAt && <Badge tone={orderStatusTone(o.status)} dot className="shrink-0">{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>}
              </div>
              {o.review ? <ReviewCard review={o.review} /> : o.canReview ? (
                <Button variant="secondary" size="lg" className="w-fit" onClick={() => setReviewing(o)}><Star /> Donner mon avis</Button>
              ) : <p className="text-[13px] text-muted-foreground">Vous pourrez donner votre avis une fois la commande terminée.</p>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!reviewing} onOpenChange={(v) => { if (!v) setReviewing(null); }} title={`Votre avis · commande n°${reviewing?.number ?? ""}`} size="sm">
        {reviewing && (
          <ReviewForm onSubmit={async (v) => {
            const next = await c.api.reviewOrder(reviewing.id, v);
            qc.setQueryData<CustomerOrder[]>(c.key("orders"), (l) => l?.map((x) => (x.id === next.id ? next : x)));
            toast.success("Merci pour votre avis");
            setReviewing(null);
          }} />
        )}
      </Dialog>
    </div>
  );
}
