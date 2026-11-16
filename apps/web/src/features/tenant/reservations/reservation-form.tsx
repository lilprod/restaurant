import type { Availability, Reservation, WaitlistEntry } from "@restaurant/api-client";
import { localTimeToInstant } from "@restaurant/utils";
import { convertWaitlistSchema, createReservationSchema, updateReservationSchema } from "@restaurant/validation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarX2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ApiError } from "@restaurant/api-client";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { SwitchRow } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { tenantKeys } from "@/lib/tenant-keys";
import { useOperations, useTenant, useTimezone } from "../hooks";
import { useTables } from "../tables/tables-page";
import { useApplyReservation } from "./hooks";
import { dayOf, fmtTime, todayIn } from "./time";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Modification d'une réservation existante. */
  reservation?: Reservation;
  /** Conversion d'une entrée de la liste d'attente en réservation. */
  fromWaitlist?: WaitlistEntry;
  defaultDate: string;
  onSaved?: (r: Reservation) => void;
}

type Errors = Partial<Record<string, string>>;

/** Création / modification d'une réservation (recherche de créneau) et conversion d'une entrée de la liste d'attente. */
export function ReservationFormDialog({ open, onOpenChange, ...rest }: Props) {
  // Le contenu est remonté à chaque ouverture : état initial propre.
  return <Dialog open={open} onOpenChange={onOpenChange} title={rest.fromWaitlist ? "Convertir en réservation" : rest.reservation ? `Modifier la réservation ${rest.reservation.code}` : "Nouvelle réservation"} size="lg" dismissable={false}
    description={rest.fromWaitlist ? "Choisissez un créneau : l'entrée de la liste d'attente sera marquée « Réservé »." : undefined}>
    {open && <FormBody {...rest} close={() => onOpenChange(false)} />}
  </Dialog>;
}

function FormBody({ reservation, fromWaitlist, defaultDate, onSaved, close }: Omit<Props, "open" | "onOpenChange"> & { close: () => void }) {
  const t = useTenant();
  const tz = useTimezone();
  const ops = useOperations() as { maxPartySize?: number };
  const apply = useApplyReservation();
  const tables = useTables();
  const editing = !!reservation;
  const converting = !!fromWaitlist;
  const initialStart = reservation?.startsAt ?? fromWaitlist?.desiredAt;

  const [source, setSource] = React.useState<"PHONE" | "WALK_IN">("PHONE");
  const [name, setName] = React.useState(reservation?.guestName ?? fromWaitlist?.guestName ?? "");
  const [phone, setPhone] = React.useState(reservation?.guestPhone ?? fromWaitlist?.guestPhone ?? "");
  const [email, setEmail] = React.useState(reservation?.guestEmail ?? fromWaitlist?.guestEmail ?? "");
  const [party, setParty] = React.useState(reservation?.partySize ?? fromWaitlist?.partySize ?? 2);
  const [date, setDate] = React.useState(initialStart ? dayOf(initialStart, tz) : defaultDate);
  const [startsAt, setStartsAt] = React.useState<string | null>(initialStart ?? null);
  const [tableId, setTableId] = React.useState<string>("");
  const [requests, setRequests] = React.useState(reservation?.specialRequests ?? "");
  const [notes, setNotes] = React.useState(reservation?.notes ?? fromWaitlist?.notes ?? "");
  const [force, setForce] = React.useState(false);
  const [forceTime, setForceTime] = React.useState(initialStart ? fmtTime(initialStart, tz) : "19:00");
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Errors>({});
  const [serverError, setServerError] = React.useState<unknown>(null);

  const walkIn = source === "WALK_IN" && !editing && !converting;
  const searchSlots = !walkIn && !force;
  const avail = useQuery({
    queryKey: [...tenantKeys.reservations(t.root), "availability", date, party, reservation?.id ?? null],
    queryFn: () => t.api.reservations.availability({ date, partySize: party, excludeReservationId: reservation?.id }),
    enabled: searchSlots && /^\d{4}-\d{2}-\d{2}$/.test(date),
    placeholderData: (prev) => prev,
  });
  const slots = avail.data?.slots ?? [];
  const chosenSlot = slots.find((s) => s.startsAt === startsAt);
  const activeTables = (tables.data ?? []).filter((x) => x.isActive);

  const save = useMutation({
    mutationFn: async () => {
      const tableIds = tableId ? [tableId] : undefined;
      const instant = force ? localTimeToInstant(date, forceTime, tz) : startsAt ? new Date(startsAt) : null;
      const forced = force ? { force: true, overrideReason: reason } : {};
      if (converting) {
        const body = convertWaitlistSchema.safeParse({ startsAt: instant ?? undefined, tableIds, ...forced });
        if (!body.success) throw body.error;
        const raw = { ...body.data, startsAt: body.data.startsAt?.toISOString() } as never;
        return (await t.api.waitlist.convert(fromWaitlist!.id, raw)).reservation;
      }
      if (editing) {
        const changed: Record<string, unknown> = {
          guestName: name, guestPhone: phone, guestEmail: email, specialRequests: requests, notes, ...forced,
        };
        if (party !== reservation!.partySize) changed.partySize = party;
        if (instant && +instant !== +new Date(reservation!.startsAt)) changed.startsAt = instant;
        if (tableIds) changed.tableIds = tableIds;
        const body = updateReservationSchema.safeParse(changed);
        if (!body.success) throw body.error;
        return t.api.reservations.update(reservation!.id, { ...body.data, startsAt: body.data.startsAt?.toISOString() } as never);
      }
      const body = createReservationSchema.safeParse({
        source, guestName: name, guestPhone: phone, guestEmail: email, partySize: party,
        startsAt: walkIn ? undefined : instant ?? undefined, tableIds, specialRequests: requests, notes, ...forced,
      });
      if (!body.success) throw body.error;
      return t.api.reservations.create({ ...body.data, startsAt: body.data.startsAt?.toISOString() } as never);
    },
    onSuccess: (r) => {
      apply(r);
      toast.success(converting ? `Réservation ${r.code} créée depuis la liste d'attente` : editing ? "Réservation modifiée" : `Réservation ${r.code} enregistrée`);
      onSaved?.(r);
      close();
    },
    onError: (e) => {
      if (isZodError(e)) {
        const next: Errors = {};
        for (const i of e.issues) next[String(i.path[0] ?? "")] ??= i.message;
        setErrors(next); setServerError(null);
        return;
      }
      if (e instanceof ApiError && e.errors.length) {
        const next: Errors = {};
        for (const x of e.errors) next[x.path.split(".")[0] ?? ""] ??= x.message;
        setErrors(next);
      } else setErrors({});
      setServerError(e);
    },
  });
  const submit = () => { setErrors({}); setServerError(null); save.mutate(); };

  const maxParty = force ? 100 : ops.maxPartySize ?? 20;
  const conflict = serverError instanceof ApiError && (serverError.status === 409 || serverError.status === 400);

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate className="flex flex-col gap-5">
      {!editing && !converting && (
        <Segmented ariaLabel="Type de réservation" value={source} onChange={setSource}
          options={[{ value: "PHONE", label: "Réservation" }, { value: "WALK_IN", label: "Sans réservation" }]} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom du client" required error={errors.guestName}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Téléphone" error={errors.guestPhone}><Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="90 00 00 00" /></Field>
        <Field label="Email" error={errors.guestEmail}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Nombre de personnes" error={errors.partySize}>
          <div><Stepper label="personnes" value={party} min={1} max={maxParty} onChange={setParty} /></div>
        </Field>
      </div>

      {!walkIn && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" error={errors.startsAt}>
              <Input type="date" value={date} min={force ? undefined : todayIn(tz)} onChange={(e) => { setDate(e.target.value); setStartsAt(null); }} className="font-mono" />
            </Field>
            {force ? (
              <Field label="Heure (forcée)" required><Input type="time" value={forceTime} onChange={(e) => setForceTime(e.target.value)} className="font-mono" /></Field>
            ) : (
              <Field label="Attribution" hint={chosenSlot?.tables.length ? `Proposition : ${chosenSlot.tables.map((x) => x.label).join(" + ")}` : undefined}>
                <NativeSelect value={tableId} onChange={(e) => setTableId(e.target.value)}>
                  <option value="">Automatique (plus petite table suffisante)</option>
                  {activeTables.map((x) => <option key={x.id} value={x.id}>{x.label} · {x.capacity} places</option>)}
                </NativeSelect>
              </Field>
            )}
          </div>
          {!force && <SlotPicker avail={avail.data} loading={avail.isFetching && !avail.data} error={avail.error} value={startsAt} onChange={setStartsAt} tz={tz} onRetry={() => avail.refetch()} current={reservation?.startsAt} />}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Demandes du client" hint="Allergies, anniversaire, chaise bébé…" error={errors.specialRequests}>
          <Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Notes internes" hint="Jamais montrées au client." error={errors.notes}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      </div>

      {t.isManager && !walkIn && (
        <div className="rounded-lg border border-border bg-subtle px-4">
          <SwitchRow label="Forcer" description="Passer outre horaires, délai ou capacité (jamais la double réservation). Un motif est obligatoire."
            checked={force} onCheckedChange={setForce} />
          {force && (
            <div className="pb-4">
              <Field label="Motif du forçage" required error={errors.overrideReason}><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Ex. client habitué, table de la direction" /></Field>
            </div>
          )}
        </div>
      )}

      {serverError != null && (
        <Callout tone="danger" title={errorMessage(serverError)}
          action={conflict && t.isManager && !force && !walkIn ? <Button size="sm" variant="secondary" onClick={() => setForce(true)}>Forcer…</Button> : undefined}>
          {conflict && !t.isManager ? "Demandez à un responsable pour forcer cette réservation." : undefined}
        </Callout>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={close} disabled={save.isPending}>Annuler</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {converting ? "Créer la réservation" : editing ? "Enregistrer" : walkIn ? "Enregistrer l'arrivée" : "Enregistrer la réservation"}
        </Button>
      </div>
    </form>
  );
}

function isZodError(e: unknown): e is { issues: { path: (string | number)[]; message: string }[] } {
  return typeof e === "object" && e !== null && "issues" in e && Array.isArray((e as { issues: unknown }).issues);
}

/** Grille de créneaux proposés (heure locale) ; les créneaux complets ou passés sont grisés avec leur raison. */
function SlotPicker({ avail, loading, error, value, onChange, tz, onRetry, current }: {
  avail?: Availability; loading: boolean; error: unknown; value: string | null; onChange: (v: string) => void; tz: string; onRetry: () => void; current?: string;
}) {
  if (loading) return <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11 sm:h-9" />)}</div>;
  if (error) return <Callout tone="danger" title={errorMessage(error)} action={<Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>} />;
  if (!avail) return null;
  if (avail.closed || avail.slots.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        <CalendarX2 className="size-4" /> {avail.closed ? `Fermé ce jour${avail.closureReason ? ` : ${avail.closureReason}` : ""}.` : "Aucun horaire d'ouverture ce jour-là."}
      </p>
    );
  }
  const free = avail.slots.filter((s) => s.available).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-muted-foreground" aria-live="polite">{free ? `${free} créneau${free > 1 ? "x" : ""} disponible${free > 1 ? "s" : ""}` : "Aucun créneau disponible ce jour-là."}</p>
      <div role="radiogroup" aria-label="Créneau" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {avail.slots.map((s) => {
          const on = s.startsAt === value;
          return (
            <button key={s.startsAt} type="button" role="radio" aria-checked={on} disabled={!s.available && s.startsAt !== current}
              title={!s.available ? (s.reason === "past" ? "Créneau passé" : "Complet") : undefined}
              onClick={() => onChange(s.startsAt)}
              className={cn("h-11 rounded-md border font-mono text-sm tabular-nums transition-colors sm:h-9",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through",
                on ? "border-transparent bg-brand text-brand-foreground" : "border-border bg-background hover:bg-hover")}>
              {fmtTime(s.startsAt, tz)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
