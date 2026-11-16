import type { Review, ReviewStats } from "@restaurant/api-client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, MessageSquareReply, Star, Trash2 } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDateShort } from "@/lib/format";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { Stars } from "../../customer/stars";
import { useTenant } from "../hooks";

type Status = "all" | "visible" | "hidden";
const PAGE = 15;

/** Avis des clients (responsables) : moyenne et répartition, modération (masquer), réponse publique. */
export function ReviewsPage() {
  const t = useTenant();
  const [status, setStatus] = useUrlParam("statut", "all") as unknown as [Status, (v: Status) => void];
  const [rating, setRating] = useUrlParam("note", "");
  const [unanswered, setUnanswered] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const stats = useQuery({ queryKey: t.key("reviews", "stats"), queryFn: () => t.api.reviews.stats() });
  const list = useQuery({
    queryKey: t.key("reviews", "list", status, rating, String(unanswered), String(page)),
    queryFn: () => t.api.reviews.list({ status, ...(rating ? { rating: Number(rating) } : {}), unanswered, page, pageSize: PAGE }),
    placeholderData: keepPreviousData,
  });
  React.useEffect(() => setPage(1), [status, rating, unanswered]);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Avis" description="Ce que pensent vos clients. Masquez un avis inapproprié ou répondez publiquement." />
      <Summary stats={stats.data} loading={stats.isLoading} error={stats.error} onRetry={() => stats.refetch()} />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Segmented ariaLabel="Filtrer par visibilité" value={status} onChange={setStatus}
          options={[{ value: "all", label: "Tous" }, { value: "visible", label: "Publiés" }, { value: "hidden", label: "Masqués" }]} />
        <Segmented ariaLabel="Filtrer par note" value={rating || "0"} onChange={(v) => setRating(v === "0" ? "" : v)}
          options={[{ value: "0", label: "Toutes notes" }, ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: <span className="inline-flex items-center gap-1">{n}<Star className="size-3" /></span> }))]} />
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
          <Switch checked={unanswered} onCheckedChange={setUnanswered} aria-label="Sans réponse seulement" /> Sans réponse
        </label>
      </div>

      {list.isError && !list.data ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data ? (
        <div className="flex flex-col gap-3" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<Star />} title={status !== "all" || rating || unanswered ? "Aucun avis ne correspond" : "Pas encore d'avis"}
          description={status !== "all" || rating || unanswered ? "Modifiez les filtres pour voir d'autres avis." : "Les clients peuvent donner leur avis une fois leur commande terminée, avec le lien imprimé sur le ticket."} />
      ) : (
        <>
          <ul className={cn("flex flex-col gap-3", list.isPlaceholderData && "opacity-60 transition-opacity")}>
            {list.data.items.map((r) => <li key={r.id}><ReviewItem r={r} /></li>)}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</Button>
              <span className="text-muted-foreground">Page {page} sur {pages}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Suivant</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Summary({ stats, loading, error, onRetry }: { stats?: ReviewStats; loading: boolean; error: unknown; onRetry: () => void }) {
  if (error && !stats) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || !stats) return <Skeleton className="h-44 rounded-xl" />;
  return (
    <section aria-label="Statistiques" className="grid gap-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:grid-cols-[auto_1fr] sm:p-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-5xl font-semibold tabular-nums tracking-tight" data-testid="avg">{stats.average !== null ? stats.average.toLocaleString("fr-FR") : "–"}<span className="text-xl text-muted-foreground"> / 5</span></p>
        {stats.average !== null && <Stars value={stats.average} size={20} />}
        <p className="text-sm text-muted-foreground">{stats.count} avis</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {stats.unanswered > 0 && <Badge tone="amber" dot>{stats.unanswered} sans réponse</Badge>}
          {stats.hiddenCount > 0 && <Badge tone="gray">{stats.hiddenCount} masqué{stats.hiddenCount > 1 ? "s" : ""}</Badge>}
        </div>
      </div>
      <ul className="flex flex-col justify-center gap-2" aria-label="Répartition des notes">
        {[5, 4, 3, 2, 1].map((n) => {
          const count = stats.distribution[String(n) as "1"];
          const pct = stats.count ? Math.round((count / stats.count) * 100) : 0;
          return (
            <li key={n} className="flex items-center gap-3 text-sm">
              <span className="flex w-8 items-center gap-1 font-mono tabular-nums">{n}<Star className="size-3 text-muted-foreground" aria-hidden /></span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${count} avis, ${pct} %`}><span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} /></span>
              <span className="w-8 text-right font-mono tabular-nums text-muted-foreground">{count}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReviewItem({ r }: { r: Review }) {
  const t = useTenant();
  const to = useSpacePath();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [replying, setReplying] = React.useState(false);
  const [text, setText] = React.useState(r.reply ?? "");
  const [err, setErr] = React.useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: t.key("reviews") });
  const hide = useMutation({ mutationFn: () => (r.hidden ? t.api.reviews.unhide(r.id) : t.api.reviews.hide(r.id)), onSuccess: () => { toast.success(r.hidden ? "Avis de nouveau publié" : "Avis masqué"); void refresh(); }, onError: (e) => toastError(e) });
  const reply = useMutation({ mutationFn: () => t.api.reviews.reply(r.id, text), onSuccess: () => { toast.success("Réponse publiée"); setReplying(false); setErr(null); void refresh(); }, onError: (e) => setErr(errorMessage(e)) });
  const unreply = useMutation({ mutationFn: () => t.api.reviews.deleteReply(r.id), onSuccess: () => { toast.success("Réponse supprimée"); setText(""); void refresh(); }, onError: (e) => toastError(e) });
  const askHide = () => confirm({
    title: "Masquer cet avis ?", description: "Il ne sera plus visible du public ni compté dans la moyenne affichée. Vous pourrez le publier de nouveau.",
    confirmLabel: "Masquer", tone: "danger", onConfirm: () => hide.mutateAsync(),
  });

  return (
    <article className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5", r.hidden && "bg-subtle")} data-testid="review">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <Stars value={r.rating} size={18} />
          <p className="text-sm"><span className="font-medium">{r.author}</span> <span className="text-muted-foreground">· {formatDateShort(r.createdAt)} · <Link className="underline-offset-4 hover:underline" to={to(`/commandes/${r.order.id}`)}>commande n°<span className="font-mono">{r.order.number}</span></Link>{r.hasAccount ? " · compte client" : ""}</span></p>
        </div>
        <div className="flex gap-1.5">{r.hidden && <Badge tone="gray" dot>Masqué</Badge>}{!r.hidden && r.reply && <Badge tone="green" dot>Répondu</Badge>}</div>
      </div>
      {r.comment ? <p className="whitespace-pre-line text-[15px]">{r.comment}</p> : <p className="text-sm italic text-muted-foreground">Sans commentaire</p>}

      {r.reply && !replying && (
        <div className="rounded-md border-l-2 border-brand bg-subtle px-3 py-2 text-sm">
          <p className="text-[12px] font-medium text-muted-foreground">Votre réponse · {r.repliedAt ? formatDateShort(r.repliedAt) : ""}</p>
          <p className="mt-0.5 whitespace-pre-line">{r.reply}</p>
        </div>
      )}
      {replying && (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); reply.mutate(); }}>
          <Field label="Réponse publique" hint="Visible par tous sous l'avis. Restez courtois et concis."><Textarea rows={3} maxLength={600} autoFocus value={text} onChange={(e) => setText(e.target.value)} /></Field>
          {err && <Callout tone="danger" title={err} />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => { setReplying(false); setText(r.reply ?? ""); setErr(null); }}>Annuler</Button>
            <Button type="submit" variant="primary" loading={reply.isPending} disabled={text.trim().length < 2}>Publier la réponse</Button>
          </div>
        </form>
      )}
      {!replying && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReplying(true)}><MessageSquareReply /> {r.reply ? "Modifier la réponse" : "Répondre"}</Button>
          {r.reply && <Button variant="ghost" size="sm" onClick={() => unreply.mutate()} loading={unreply.isPending}><Trash2 /> Supprimer la réponse</Button>}
          {r.hidden
            ? <Button variant="ghost" size="sm" onClick={() => hide.mutate()} loading={hide.isPending}><Eye /> Publier de nouveau</Button>
            : <Button variant="ghost" size="sm" onClick={askHide}><EyeOff /> Masquer</Button>}
        </div>
      )}
    </article>
  );
}
