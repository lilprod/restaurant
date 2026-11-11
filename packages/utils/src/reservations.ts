/**
 * Réservations : calcul pur des créneaux disponibles et de l'attribution des tables.
 * Utilisé par l'API (et réutilisable par le web). Tout est en instants UTC ; les horaires sont exprimés
 * en heure locale du restaurant (fuseau IANA), changement d'heure compris.
 * La contrainte d'exclusion en base reste l'arbitre final en cas de requêtes simultanées.
 */

export type ReservationState = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/** Transitions autorisées du cycle de vie d'une réservation. */
const NEXT: Record<ReservationState, ReservationState[]> = {
  PENDING: ["CONFIRMED", "SEATED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
  SEATED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};
export const canTransitionReservation = (from: ReservationState, to: ReservationState) => NEXT[from].includes(to);
/** Statuts qui occupent une table (les autres la libèrent). */
export const ACTIVE_RESERVATION_STATUSES: ReservationState[] = ["PENDING", "CONFIRMED", "SEATED"];

/** Plage d'ouverture hebdomadaire (heure locale). `closesAt` ≤ `opensAt` = fermeture après minuit ; "24:00" accepté. */
export interface OpeningRange {
  /** 0 = dimanche … 6 = samedi. */
  weekday: number;
  opensAt: string;
  closesAt: string;
  slotMinutes?: number;
}

export interface OpeningWindow {
  start: Date;
  end: Date;
  slotMinutes: number;
  /** Heure locale d'ouverture en minutes (sert à générer les créneaux en heure locale). */
  opensAtMinutes: number;
}

export interface AvailabilityTable { id: string; label: string; capacity: number; minCapacity?: number }

/** Occupation existante d'une table, tampon de nettoyage déjà inclus dans `end`. */
export interface BusyInterval { tableId: string; start: Date; end: Date }

const MIN = 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

export const isValidTime = (s: string) => HHMM.test(s);
export const toMinutes = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/** Décalage (ms) du fuseau à un instant donné : heure locale − UTC. */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const v = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(at / 1000) * 1000;
}

/** Jour local (AAAA-MM-JJ) décalé de `n` jours. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Jour de la semaine (0 = dimanche) d'un jour calendaire. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Instant UTC d'une heure locale (« jour » + « HH:MM » dans le fuseau).
 * Retourne `null` si l'heure n'existe pas ce jour-là (saut du changement d'heure de printemps) ;
 * une heure ambiguë (retour à l'heure d'hiver) donne la première occurrence.
 */
export function localTimeToInstant(day: string, time: string, timeZone: string): Date | null {
  const [y, m, d] = day.split("-").map(Number);
  const minutes = toMinutes(time);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  // décalages possibles autour de cette heure (au plus un changement d'heure par jour) ; on garde les candidats
  // qui retombent bien sur l'heure demandée, le plus tôt d'abord
  const candidates = [wall - offsetAt(wall - 86_400_000, timeZone), wall - offsetAt(wall + 86_400_000, timeZone)];
  const ok = candidates.filter((c) => c + offsetAt(c, timeZone) === wall).sort((a, b) => a - b);
  return ok.length ? new Date(ok[0]) : null;
}

/** Plages d'ouverture d'une journée de service (vide si fermeture exceptionnelle). */
export function openingWindows(day: string, timeZone: string, hours: OpeningRange[], closures: string[] = [], defaultSlotMinutes = 15): OpeningWindow[] {
  if (closures.includes(day)) return [];
  const wd = weekdayOf(day);
  const out: OpeningWindow[] = [];
  for (const h of hours.filter((r) => r.weekday === wd)) {
    const start = localTimeToInstant(day, h.opensAt, timeZone);
    const overnight = toMinutes(h.closesAt) <= toMinutes(h.opensAt);
    const end = h.closesAt === "24:00" || (overnight && h.closesAt === "00:00")
      ? localTimeToInstant(addDays(day, 1), "00:00", timeZone)
      : localTimeToInstant(overnight ? addDays(day, 1) : day, h.closesAt, timeZone);
    if (start && end && end > start) out.push({ start, end, slotMinutes: h.slotMinutes ?? defaultSlotMinutes, opensAtMinutes: toMinutes(h.opensAt) });
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Débuts de créneaux d'une journée de service : pas de `slotMinutes` en heure locale à partir de l'ouverture,
 * la réservation entière (`durationMinutes`) devant tenir avant la fermeture.
 */
export function slotStarts(day: string, timeZone: string, hours: OpeningRange[], closures: string[], durationMinutes: number, defaultSlotMinutes = 15): Date[] {
  const out: Date[] = [];
  for (const w of openingWindows(day, timeZone, hours, closures, defaultSlotMinutes)) {
    for (let k = 0; k < 2880; k++) {
      const total = w.opensAtMinutes + k * w.slotMinutes;
      const d = addDays(day, Math.floor(total / 1440));
      const mm = total % 1440;
      const t = localTimeToInstant(d, `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`, timeZone);
      if (!t) continue; // heure inexistante (changement d'heure)
      if (t.getTime() + durationMinutes * MIN > w.end.getTime()) break;
      if (t >= w.start && !out.some((o) => o.getTime() === t.getTime())) out.push(t);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** `true` si [start, start + durée] tient entièrement dans une plage d'ouverture. */
export function fitsOpening(start: Date, durationMinutes: number, windows: OpeningWindow[]): boolean {
  const end = start.getTime() + durationMinutes * MIN;
  return windows.some((w) => start >= w.start && end <= w.end.getTime());
}

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

/**
 * Choix des tables : la plus petite table suffisante (capacité ≥ convives ≥ capacité minimale), sinon la combinaison
 * de deux tables libres de capacité totale minimale. `null` si rien ne convient.
 */
export function pickTables<T extends AvailabilityTable>(tables: T[], partySize: number, isFree: (t: T) => boolean, maxCombination = 2): T[] | null {
  const byLabel = (a: T, b: T) => a.label.localeCompare(b.label, "fr", { numeric: true });
  const free = tables.filter(isFree);
  const single = free
    .filter((t) => t.capacity >= partySize && (t.minCapacity ?? 1) <= partySize)
    .sort((a, b) => a.capacity - b.capacity || byLabel(a, b))[0];
  if (single) return [single];
  if (maxCombination < 2) return null;
  let best: [T, T] | null = null;
  const sorted = [...free].sort((a, b) => a.capacity - b.capacity || byLabel(a, b));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const total = sorted[i].capacity + sorted[j].capacity;
      if (total < partySize) continue;
      if (!best || total < best[0].capacity + best[1].capacity) best = [sorted[i], sorted[j]];
    }
  }
  return best;
}

/** Une table est-elle libre sur [start, end) (tampon compris) ? */
export function isTableFree(tableId: string, start: Date, end: Date, busy: BusyInterval[]): boolean {
  return !busy.some((b) => b.tableId === tableId && overlaps(start, end, b.start, b.end));
}

export interface AvailabilityInput {
  /** Journée de service (AAAA-MM-JJ, heure locale). */
  day: string;
  timeZone: string;
  hours: OpeningRange[];
  /** Jours de fermeture exceptionnelle (AAAA-MM-JJ). */
  closures: string[];
  partySize: number;
  durationMinutes: number;
  bufferMinutes: number;
  defaultSlotMinutes: number;
  tables: AvailabilityTable[];
  busy: BusyInterval[];
  now: Date;
  /** Délai minimal avant le créneau (réservation en ligne). 0 = seulement les créneaux futurs. */
  minNoticeMinutes?: number;
  /** Fenêtre de réservation (jours) : au-delà, aucun créneau. Absent = illimitée. */
  bookingWindowDays?: number;
}

export interface AvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
  available: boolean;
  /** Tables proposées (une, ou deux combinées) ; vide si complet. */
  tables: AvailabilityTable[];
  /** Raison d'indisponibilité : `past` (trop tard), `full` (aucune table). */
  reason?: "past" | "full";
}

/** Créneaux d'une journée avec, pour chacun, les tables proposées. */
export function computeAvailability(input: AvailabilityInput): AvailabilitySlot[] {
  const { day, timeZone, partySize, durationMinutes, bufferMinutes, now } = input;
  if (input.bookingWindowDays !== undefined) {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    if (day > addDays(today, input.bookingWindowDays)) return [];
  }
  const earliest = now.getTime() + (input.minNoticeMinutes ?? 0) * MIN;
  return slotStarts(day, timeZone, input.hours, input.closures, durationMinutes, input.defaultSlotMinutes).map((start) => {
    const endsAt = new Date(start.getTime() + durationMinutes * MIN);
    if (start.getTime() < earliest) return { startsAt: start, endsAt, available: false, tables: [], reason: "past" as const };
    const blockedUntil = new Date(endsAt.getTime() + bufferMinutes * MIN);
    const picked = pickTables(input.tables, partySize, (t) => isTableFree(t.id, start, blockedUntil, input.busy));
    return picked
      ? { startsAt: start, endsAt, available: true, tables: picked }
      : { startsAt: start, endsAt, available: false, tables: [], reason: "full" as const };
  });
}

/** Alphabet des codes de réservation : sans 0/O, 1/I/L (lisibles au téléphone). */
export const RESERVATION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Code court lisible (ex. « R7K2Q ») à partir d'octets aléatoires. */
export function reservationCode(random: Uint8Array, length = 5): string {
  let s = "";
  for (let i = 0; i < length; i++) s += RESERVATION_CODE_ALPHABET[random[i] % RESERVATION_CODE_ALPHABET.length];
  return s;
}

/** Instant du rappel « la veille à `hour` h locale » d'une réservation. */
export function reminderInstant(startsAt: Date, timeZone: string, hour = 18): Date | null {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(startsAt);
  return localTimeToInstant(addDays(day, -1), `${String(hour).padStart(2, "0")}:00`, timeZone);
}
