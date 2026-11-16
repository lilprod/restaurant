import { ApiError } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClockAlert, PartyPopper } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { publicSpace } from "@/app/spaces";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpacePath } from "@/providers/space";
import { PublicShell } from "../public-reservation/shared";
import { ReviewCard, ReviewForm } from "./review-form";

/** Page d'avis (lien du ticket, sans compte) : une fois la commande clôturée, un avis par commande. */
export function ReviewPage() {
  const { token = "" } = useParams();
  const to = useSpacePath();
  const qc = useQueryClient();
  const key = ["public", "tracking", token];
  const q = useQuery({ queryKey: key, queryFn: () => publicSpace.tracking(token), retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 });
  const send = useMutation({ mutationFn: (v: Parameters<typeof publicSpace.trackingReview>[1]) => publicSpace.trackingReview(token, v), onSuccess: (o) => qc.setQueryData(key, o) });

  if (q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410)) {
    return <PublicShell title="Votre avis"><EmptyState icon={<ClockAlert />} title={q.error.status === 410 ? "Ce lien a expiré" : "Lien invalide"} description="Vous ne pouvez plus donner d'avis avec ce lien." /></PublicShell>;
  }
  if (q.isError && !q.data) return <PublicShell title="Votre avis"><ErrorState error={q.error} onRetry={() => q.refetch()} /></PublicShell>;
  const o = q.data;
  if (!o) return <PublicShell title="Votre avis"><div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-9 w-56" /><Skeleton className="h-60 rounded-xl" /></div></PublicShell>;

  return (
    <PublicShell title="Votre avis">
      <div className="flex flex-col gap-6" data-testid="review-page">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">{o.restaurant.name} · commande n°<span className="font-mono">{o.number}</span></p>
          <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight text-balance">{o.review ? "Merci pour votre avis" : "Comment était votre repas ?"}</h1>
        </div>
        {o.review ? (
          <>
            <Callout tone="success" title={<span className="inline-flex items-center gap-2"><PartyPopper className="size-4" /> Votre avis a bien été enregistré.</span>} />
            <ReviewCard review={o.review} restaurant={o.restaurant.name} />
          </>
        ) : o.canReview ? (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm"><ReviewForm askName onSubmit={(v) => send.mutateAsync(v)} /></div>
        ) : (
          <Callout tone="info" title="Vous pourrez donner votre avis une fois la commande terminée.">Revenez sur cette page après le repas, avec le même lien.</Callout>
        )}
        <Button asChild variant="secondary" className="w-fit"><Link to={to(`/suivi/${token}`)}>Retour au suivi</Link></Button>
      </div>
    </PublicShell>
  );
}
