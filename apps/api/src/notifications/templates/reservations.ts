import { fitSms, type TemplateDef } from "./types";

/** Variables communes des messages de réservation (dates déjà formatées dans le fuseau du restaurant). */
export interface ReservationData {
  guestName: string;
  code: string;
  /** Ex. « jeudi 12 novembre 2026 à 19:30 ». */
  when: string;
  partySize: number;
  /** Lien de gestion (modifier / annuler) : uniquement dans le message de création, jamais par SMS. */
  manageUrl?: string;
}
export interface ReservationCancelledData extends ReservationData { reason?: string }
export interface WaitlistAvailableData { guestName: string; when: string; partySize: number }

const people = (n: number) => `${n} personne${n > 1 ? "s" : ""}`;
const manage = (d: ReservationData) => (d.manageUrl ? { action: { label: "Gérer ma réservation", url: d.manageUrl } } : {});

/** Réservation enregistrée et confirmée. Contient le lien de gestion : variables jamais conservées. */
export const reservationConfirmed: TemplateDef<ReservationData> = {
  category: "reminder",
  event: "reservations",
  sensitive: true,
  email: (d, b) => ({
    subject: `Réservation confirmée chez ${b.name} — ${d.when}`,
    paragraphs: [`Bonjour ${d.guestName},`, `Votre table pour ${people(d.partySize)} est réservée le ${d.when}.`, `Code de réservation : ${d.code}`],
    ...manage(d),
    note: "Un empêchement ? Modifiez ou annulez votre réservation depuis le lien ci-dessus, ou appelez le restaurant.",
  }),
  sms: (d, b) => fitSms(`${b.name} : réservation confirmée le ${d.when}, ${people(d.partySize)}. Code ${d.code}.`),
};

/** Réservation en ligne reçue, en attente de confirmation par le restaurant (réglage `requireConfirmation`). */
export const reservationPending: TemplateDef<ReservationData> = {
  category: "reminder",
  event: "reservations",
  sensitive: true,
  email: (d, b) => ({
    subject: `Demande de réservation reçue — ${b.name}`,
    paragraphs: [
      `Bonjour ${d.guestName},`,
      `Nous avons bien reçu votre demande pour ${people(d.partySize)} le ${d.when}.`,
      "Le restaurant va la confirmer : vous recevrez un message dès que c'est fait.",
      `Code de réservation : ${d.code}`,
    ],
    ...manage(d),
  }),
  sms: (d, b) => fitSms(`${b.name} : demande de réservation reçue pour le ${d.when} (${people(d.partySize)}). Code ${d.code}. Confirmation à suivre.`),
};

/** Réservation confirmée par la salle après une demande en ligne, ou modifiée (date, heure, nombre de personnes). */
export const reservationUpdated: TemplateDef<ReservationData & { confirmedNow?: boolean }> = {
  category: "reminder",
  event: "reservations",
  email: (d, b) => ({
    subject: d.confirmedNow ? `Réservation confirmée chez ${b.name} — ${d.when}` : `Réservation modifiée — ${b.name}`,
    paragraphs: [
      `Bonjour ${d.guestName},`,
      d.confirmedNow
        ? `Le restaurant a confirmé votre réservation pour ${people(d.partySize)} le ${d.when}.`
        : `Votre réservation est désormais prévue le ${d.when}, pour ${people(d.partySize)}.`,
      `Code de réservation : ${d.code}`,
    ],
  }),
  sms: (d, b) => fitSms(d.confirmedNow
    ? `${b.name} : réservation confirmée le ${d.when}, ${people(d.partySize)}. Code ${d.code}.`
    : `${b.name} : réservation modifiée, le ${d.when}, ${people(d.partySize)}. Code ${d.code}.`),
};

export const reservationCancelled: TemplateDef<ReservationCancelledData> = {
  category: "reminder",
  event: "reservations",
  email: (d, b) => ({
    subject: `Réservation annulée — ${b.name}`,
    paragraphs: [
      `Bonjour ${d.guestName},`,
      `Votre réservation du ${d.when} (${people(d.partySize)}, code ${d.code}) est annulée.`,
      ...(d.reason ? [`Motif : ${d.reason}`] : []),
      "Au plaisir de vous accueillir une prochaine fois.",
    ],
  }),
  sms: (d, b) => fitSms(`${b.name} : votre réservation du ${d.when} (code ${d.code}) est annulée.`),
};

/** Rappel la veille à 18 h (heure du restaurant), une seule fois par réservation. */
export const reservationReminder: TemplateDef<ReservationData> = {
  category: "reminder",
  event: "reservationReminders",
  email: (d, b) => ({
    subject: `Rappel : votre table chez ${b.name} demain`,
    paragraphs: [`Bonjour ${d.guestName},`, `Nous vous attendons le ${d.when} pour ${people(d.partySize)}.`, `Code de réservation : ${d.code}`],
    note: "Un empêchement ? Prévenez le restaurant pour libérer la table.",
  }),
  sms: (d, b) => fitSms(`${b.name} : rappel, votre table vous attend le ${d.when} (${people(d.partySize)}). Code ${d.code}.`),
};

/** Liste d'attente : une place s'est libérée. */
export const waitlistAvailable: TemplateDef<WaitlistAvailableData> = {
  category: "reminder",
  event: "waitlist",
  email: (d, b) => ({
    subject: `Une table s'est libérée chez ${b.name}`,
    paragraphs: [
      `Bonjour ${d.guestName},`,
      `Une table pour ${people(d.partySize)} s'est libérée vers le ${d.when}.`,
      "Appelez le restaurant pour la confirmer : elle est proposée aux premiers qui répondent.",
    ],
  }),
  sms: (d, b) => fitSms(`${b.name} : une table pour ${people(d.partySize)} s'est libérée vers le ${d.when}. Appelez-nous pour la confirmer.`),
};
