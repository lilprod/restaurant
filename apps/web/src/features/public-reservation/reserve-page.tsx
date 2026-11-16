import { ApiError, type PublicReservationCreated } from "@restaurant/api-client";
import { publicReservationSchema } from "@restaurant/validation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCheck, CalendarX2, Clock, Users } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { publicSpace } from "@/app/spaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_TIMEZONE } from "@/lib/format";
import { dayOf, fmtDay, fmtTime, todayIn } from "../tenant/reservations/time";
import { DayChips, isDisabled, PublicShell, PublicSlots, usePublicSlug } from "./shared";

/** Réservation en ligne sans compte : nombre de personnes → jour → heure → coordonnées → confirmation avec code et lien de gestion. */
export function ReservePage() {
  const slug = usePublicSlug();
  const today = todayIn(DEFAULT_TIMEZONE);
  const [party, setParty] = React.useState(2);
  const [date, setDate] = React.useState(today);
  const [startsAt, setStartsAt] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [requests, setRequests] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState<PublicReservationCreated | null>(null);

  const avail = useQuery({
    queryKey: ["public", "availability", slug, date, party],
    queryFn: () => publicSpace.availability(slug, { date, partySize: party }),
    enabled: !!slug && /^\d{4}-\d{2}-\d{2}$/.test(date),
    placeholderData: (p) => p,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });
  const tz = avail.data?.timezone ?? DEFAULT_TIMEZONE;

  const submit = useMutation({
    mutationFn: async () => {
      const parsed = publicReservationSchema.safeParse({ guestName: name, guestPhone: phone, guestEmail: email, partySize: party, startsAt: startsAt ? new Date(startsAt) : undefined, specialRequests: requests });
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.path[0] === "startsAt" ? "Choisissez une heure" : i.message])));
        throw new Error("invalid");
      }
      setErrors({});
      return publicSpace.reserve(slug, { ...parsed.data, startsAt: parsed.data.startsAt.toISOString() } as never);
    },
    onSuccess: (r) => { setDone(r); window.scrollTo({ top: 0 }); },
    onError: (e) => {
      if (e instanceof Error && e.message === "invalid") return;
      if (e instanceof ApiError && e.errors.length) setErrors(Object.fromEntries(e.errors.map((x) => [x.path.split(".")[0]!, x.message])));
      if (e instanceof ApiError && e.status === 409) { setStartsAt(null); void avail.refetch(); }
    },
  });

  if (isDisabled(avail.error) || isDisabled(submit.error)) {
    return (
      <PublicShell title="Réserver">
        <EmptyState icon={<CalendarX2 />} title="Réservation en ligne indisponible" description="Ce restaurant ne prend pas de réservation en ligne pour le moment. Contactez-le directement." />
      </PublicShell>
    );
  }
  if (avail.isError && avail.error instanceof ApiError && avail.error.status === 404) {
    return <PublicShell title="Réserver"><EmptyState icon={<CalendarX2 />} title="Restaurant introuvable" description="Vérifiez le lien reçu." /></PublicShell>;
  }

  if (done) return <Confirmation done={done} slug={slug} />;

  return (
    <PublicShell title="Réserver une table">
      <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight">Réserver une table</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">Choisissez le jour et l'heure, sans créer de compte.</p>

      <form className="mt-6 flex flex-col gap-7" noValidate onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}>
        <section className="flex flex-col gap-3" aria-labelledby="s1">
          <h2 id="s1" className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">1. Combien de personnes ?</h2>
          <div><Stepper label="personnes" size="lg" value={party} min={1} max={30} onChange={(v) => { setParty(v); setStartsAt(null); }} /></div>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="s2">
          <h2 id="s2" className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">2. Quel jour ?</h2>
          <DayChips value={date} onChange={(d) => { setDate(d); setStartsAt(null); }} today={today} tz={tz} />
          <Field label="Autre date"><Input type="date" value={date} min={today} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setStartsAt(null); } }} className="font-mono sm:w-48" /></Field>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="s3">
          <h2 id="s3" className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">3. À quelle heure ?</h2>
          <PublicSlots data={avail.data} loading={avail.isLoading} error={avail.error} value={startsAt} onChange={setStartsAt} onRetry={() => avail.refetch()} />
          {errors.startsAt && <p role="alert" className="text-[12.5px] text-danger">{errors.startsAt}</p>}
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="s4">
          <h2 id="s4" className="text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">4. Vos coordonnées</h2>
          <Field label="Nom" required error={errors.guestName}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <Field label="Téléphone" required error={errors.guestPhone} hint="Pour vous joindre si besoin. Ex. 90 00 00 00."><Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Email (facultatif)" error={errors.guestEmail} hint="Pour recevoir la confirmation et le lien de gestion."><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Demandes particulières (facultatif)" error={errors.specialRequests}><Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} maxLength={500} placeholder="Allergies, anniversaire, chaise bébé…" /></Field>
        </section>

        {submit.isError && !(submit.error instanceof Error && submit.error.message === "invalid") && <Callout tone="danger" title={errorMessage(submit.error)} />}
        <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          {startsAt && <p className="mb-2 text-[13px] text-muted-foreground">{party} pers. · <span>{fmtDay(dayOf(startsAt, tz), { weekday: "long", day: "numeric", month: "long" })}</span> à <span className="font-mono">{fmtTime(startsAt, tz)}</span></p>}
          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" loading={submit.isPending}>Réserver la table</Button>
        </div>
      </form>
    </PublicShell>
  );
}

function Confirmation({ done, slug }: { done: PublicReservationCreated; slug: string }) {
  const r = done.reservation;
  const tz = r.restaurant.timezone;
  const pending = done.status === "PENDING";
  const manage = `${window.location.origin}/r/${slug}/reservation/${done.manageToken}`;
  return (
    <PublicShell title="Réservation enregistrée">
      <div className="flex flex-col gap-6" data-testid="reservation-confirmation">
        <div className="flex flex-col gap-2">
          <Badge tone={pending ? "amber" : "green"} dot className="w-fit">{pending ? "En attente de confirmation" : "Réservation confirmée"}</Badge>
          <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight">{pending ? "Demande reçue" : "À bientôt !"}</h1>
          <p className="text-[15px] text-muted-foreground">
            {pending ? "Le restaurant doit confirmer votre demande. Vous serez prévenu dès que ce sera fait." : "Votre table est réservée. Présentez simplement votre nom à l'arrivée."}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Code de réservation</p>
          <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.18em]" aria-label={`Code ${done.code.split("").join(" ")}`}>{done.code}</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div className="col-span-2 flex items-center gap-2"><CalendarCheck className="size-4 text-muted-foreground" /><span className="font-medium">{fmtDay(dayOf(r.startsAt, tz), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span></div>
            <div className="flex items-center gap-2"><Clock className="size-4 text-muted-foreground" /><span className="font-mono">{fmtTime(r.startsAt, tz)}</span></div>
            <div className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><span>{r.partySize} personne{r.partySize > 1 ? "s" : ""}</span></div>
          </dl>
        </div>
        <Callout tone="info" title="Gardez ce lien pour modifier ou annuler">
          <p className="break-all font-mono text-[12.5px]">{manage}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={manage} label="Copier le lien" />
            <Button asChild size="sm" variant="secondary"><Link to={`/r/${slug}/reservation/${done.manageToken}`}>Gérer ma réservation</Link></Button>
          </div>
        </Callout>
      </div>
    </PublicShell>
  );
}
