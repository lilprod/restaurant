import type { ReviewInput } from "@restaurant/validation";
import { reviewInputSchema } from "@restaurant/validation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { StarInput, Stars } from "./stars";

/** Formulaire d'avis : note de 1 à 5, commentaire facultatif, prénom facultatif (sans compte). */
export function ReviewForm({ onSubmit, askName, submitLabel = "Envoyer mon avis" }: {
  onSubmit: (v: ReviewInput) => Promise<unknown>; askName?: boolean; submitLabel?: string;
}) {
  const [rating, setRating] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = reviewInputSchema.safeParse({ rating, comment, authorName: askName ? name : undefined });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Avis invalide"); return; }
    setBusy(true);
    setError(null);
    try { await onSubmit(parsed.data); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <StarInput value={rating} onChange={(n) => { setRating(n); setError(null); }} disabled={busy} />
      <Field label="Votre commentaire" hint="Facultatif. Il sera lu par l'équipe du restaurant.">
        <Textarea rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ce que vous avez aimé, ce qui peut s'améliorer…" />
      </Field>
      {askName && (
        <Field label="Votre prénom" hint="Facultatif. Affiché avec votre avis.">
          <Input value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {error && <Callout tone="danger" title={error} />}
      <Button type="submit" variant="primary" size="lg" loading={busy}>{submitLabel}</Button>
    </form>
  );
}

/** Avis déjà déposé : note, commentaire et réponse publique du restaurant. */
export function ReviewCard({ review, restaurant }: { review: { rating: number; comment: string | null; reply: string | null }; restaurant?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-subtle p-4 text-sm">
      <Stars value={review.rating} size={18} />
      {review.comment && <p className="whitespace-pre-line">{review.comment}</p>}
      {review.reply && (
        <div className="mt-1 rounded-md border-l-2 border-brand bg-card px-3 py-2">
          <p className="text-[12px] font-medium text-muted-foreground">Réponse{restaurant ? ` de ${restaurant}` : " du restaurant"}</p>
          <p className="mt-0.5 whitespace-pre-line">{review.reply}</p>
        </div>
      )}
    </div>
  );
}
