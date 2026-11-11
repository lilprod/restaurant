import { Prisma } from "@prisma/client";

export const reservationInclude = {
  tables: { include: { table: { select: { id: true, label: true, capacity: true } } } },
  orders: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, closedAt: true, cancelledAt: true } },
} satisfies Prisma.ReservationInclude;

export type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>;

const MIN = 60_000;

/** Forme d'une réservation côté salle (réponses de l'API et événements `reservation.created|updated`). */
export function reservationView(r: ReservationRow) {
  const open = r.orders.find((o) => !o.closedAt && !o.cancelledAt);
  return {
    id: r.id, code: r.code, status: r.status, source: r.source,
    guestName: r.guestName, guestPhone: r.guestPhone, guestEmail: r.guestEmail, partySize: r.partySize,
    startsAt: r.startsAt, endsAt: r.endsAt, durationMinutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / MIN),
    tables: r.tables.map((t) => t.table).sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true })),
    specialRequests: r.specialRequests, notes: r.notes, overrideReason: r.overrideReason,
    /** Commande ouverte depuis la réservation (sinon la plus récente, sinon null). */
    orderId: (open ?? r.orders[0])?.id ?? null,
    noShowSuggested: !!r.noShowSuggestedAt && (r.status === "PENDING" || r.status === "CONFIRMED"),
    confirmedAt: r.confirmedAt, seatedAt: r.seatedAt, completedAt: r.completedAt,
    cancelledAt: r.cancelledAt, cancelReason: r.cancelReason, noShowAt: r.noShowAt, reminderSentAt: r.reminderSentAt,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}
export type ReservationView = ReturnType<typeof reservationView>;

/** Forme publique (page de gestion du client) : ni tables, ni notes internes, ni coordonnées. */
export function publicReservationView(
  r: Pick<ReservationRow, "code" | "status" | "guestName" | "partySize" | "startsAt" | "endsAt" | "specialRequests" | "createdAt">,
  restaurant: { name: string; slug: string; phone: string | null; timezone: string },
  rights: { canModify: boolean; canCancel: boolean },
) {
  return {
    code: r.code, status: r.status, guestName: r.guestName, partySize: r.partySize,
    startsAt: r.startsAt, endsAt: r.endsAt, specialRequests: r.specialRequests, createdAt: r.createdAt,
    restaurant, ...rights,
  };
}

export type WaitlistRow = Prisma.WaitlistEntryGetPayload<object>;

/** Forme d'une entrée de liste d'attente (réponses et événement `waitlist.updated`). */
export function waitlistView(w: WaitlistRow) {
  return {
    id: w.id, status: w.status, guestName: w.guestName, guestPhone: w.guestPhone, guestEmail: w.guestEmail,
    partySize: w.partySize, desiredAt: w.desiredAt, notes: w.notes, notifiedAt: w.notifiedAt,
    reservationId: w.reservationId, createdAt: w.createdAt, updatedAt: w.updatedAt,
  };
}
export type WaitlistView = ReturnType<typeof waitlistView>;
