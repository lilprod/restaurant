import {
  type AvailabilityInput, canTransitionReservation, computeAvailability, fitsOpening, localTimeToInstant, openingWindows, pickTables,
  reminderInstant, reservationCode, slotStarts, weekdayOf, RESERVATION_CODE_ALPHABET,
} from "@restaurant/utils";
import { openingHoursSchema, publicReservationSchema } from "@restaurant/validation";

const LOME = "Africa/Lome"; // UTC+0, sans changement d'heure
const PARIS = "Europe/Paris"; // changement d'heure : 29/03/2026 (02:00 → 03:00), 25/10/2026 (03:00 → 02:00)
const iso = (d: Date) => d.toISOString();
const hm = (d: Date, tz = LOME) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);

// 2026-11-12 est un jeudi (4)
const DAY = "2026-11-12";
const lunchDinner = [
  { weekday: 4, opensAt: "12:00", closesAt: "15:00", slotMinutes: 30 },
  { weekday: 4, opensAt: "19:00", closesAt: "23:00", slotMinutes: 30 },
];
const tables = [
  { id: "t2", label: "T2", capacity: 2 },
  { id: "t4", label: "T4", capacity: 4 },
  { id: "t6", label: "T6", capacity: 6 },
];
const base = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  day: DAY, timeZone: LOME, hours: lunchDinner, closures: [], partySize: 2, durationMinutes: 90, bufferMinutes: 0,
  defaultSlotMinutes: 15, tables, busy: [], now: new Date("2026-11-01T08:00:00Z"), ...over,
});

describe("réservations : conversion heure locale ↔ UTC", () => {
  it("Lomé (UTC+0)", () => {
    expect(iso(localTimeToInstant(DAY, "19:30", LOME)!)).toBe("2026-11-12T19:30:00.000Z");
    expect(weekdayOf(DAY)).toBe(4);
  });
  it("Paris : heure d'été / d'hiver", () => {
    expect(iso(localTimeToInstant("2026-07-01", "19:00", PARIS)!)).toBe("2026-07-01T17:00:00.000Z");
    expect(iso(localTimeToInstant("2026-12-01", "19:00", PARIS)!)).toBe("2026-12-01T18:00:00.000Z");
  });
  it("Paris : heure inexistante au passage à l'heure d'été → null ; heure ambiguë → première occurrence", () => {
    expect(localTimeToInstant("2026-03-29", "02:30", PARIS)).toBeNull();
    expect(iso(localTimeToInstant("2026-03-29", "03:00", PARIS)!)).toBe("2026-03-29T01:00:00.000Z");
    expect(iso(localTimeToInstant("2026-10-25", "02:30", PARIS)!)).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(localTimeToInstant("2026-10-25", "12:00", PARIS)!)).toBe("2026-10-25T11:00:00.000Z");
  });
});

describe("réservations : plages et créneaux", () => {
  it("deux plages (midi, soir) ; la réservation entière doit tenir avant la fermeture", () => {
    const s = slotStarts(DAY, LOME, lunchDinner, [], 90).map((d) => hm(d));
    expect(s).toEqual(["12:00", "12:30", "13:00", "13:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30"]);
  });
  it("jour sans horaires ou fermeture exceptionnelle → aucun créneau", () => {
    expect(slotStarts("2026-11-13", LOME, lunchDinner, [], 90)).toEqual([]);
    expect(openingWindows(DAY, LOME, lunchDinner, [DAY])).toEqual([]);
    expect(computeAvailability(base({ closures: [DAY] }))).toEqual([]);
  });
  it("plage après minuit (fermeture ≤ ouverture) et « 24:00 »", () => {
    const night = [{ weekday: 4, opensAt: "20:00", closesAt: "01:00", slotMinutes: 60 }];
    expect(slotStarts(DAY, LOME, night, [], 90).map((d) => iso(d))).toEqual(["2026-11-12T20:00:00.000Z", "2026-11-12T21:00:00.000Z", "2026-11-12T22:00:00.000Z", "2026-11-12T23:00:00.000Z"]);
    const midnight = [{ weekday: 4, opensAt: "21:00", closesAt: "24:00", slotMinutes: 30 }];
    expect(slotStarts(DAY, LOME, midnight, [], 90).map((d) => hm(d))).toEqual(["21:00", "21:30", "22:00", "22:30"]);
  });
  it("le pas par défaut s'applique quand la plage n'en précise pas", () => {
    const h = [{ weekday: 4, opensAt: "12:00", closesAt: "13:00" }];
    expect(slotStarts(DAY, LOME, h, [], 30, 10).length).toBe(4);
  });
  it("Paris le jour du passage à l'heure d'été : créneaux en heure locale, durée réelle", () => {
    // dimanche 29/03/2026, ouvert 01:00–05:00 : 02:00 et 02:30 n'existent pas
    const h = [{ weekday: 0, opensAt: "01:00", closesAt: "05:00", slotMinutes: 30 }];
    const s = slotStarts("2026-03-29", PARIS, h, [], 60).map((d) => hm(d, PARIS));
    expect(s).toEqual(["01:00", "01:30", "03:00", "03:30", "04:00"]);
    // 01:30 + 60 min réelles = 03:30 locales : tient avant 05:00
    expect(fitsOpening(localTimeToInstant("2026-03-29", "04:00", PARIS)!, 60, openingWindows("2026-03-29", PARIS, h))).toBe(true);
    expect(fitsOpening(localTimeToInstant("2026-03-29", "04:30", PARIS)!, 60, openingWindows("2026-03-29", PARIS, h))).toBe(false);
  });
  it("Paris le jour du retour à l'heure d'hiver : 12:00 locale = 11:00 UTC", () => {
    const h = [{ weekday: 0, opensAt: "12:00", closesAt: "14:00", slotMinutes: 60 }];
    expect(slotStarts("2026-10-25", PARIS, h, [], 60).map((d) => iso(d))).toEqual(["2026-10-25T11:00:00.000Z", "2026-10-25T12:00:00.000Z"]);
  });
});

describe("réservations : disponibilités", () => {
  it("propose la plus petite table suffisante", () => {
    const slots = computeAvailability(base({ partySize: 3 }));
    expect(slots.every((s) => s.available && s.tables[0].id === "t4")).toBe(true);
    expect(slots[0].endsAt.getTime() - slots[0].startsAt.getTime()).toBe(90 * 60_000);
  });
  it("combinaison de deux tables si aucune ne suffit", () => {
    const slot = computeAvailability(base({ partySize: 9 }))[0];
    expect(slot.tables.map((t) => t.id).sort()).toEqual(["t4", "t6"]);
    expect(computeAvailability(base({ partySize: 13 }))[0]).toMatchObject({ available: false, reason: "full" });
  });
  it("occupation existante et tampon de nettoyage", () => {
    // T2 occupée 19:00–20:30 (+15 min de tampon déjà inclus → 20:45)
    const busy = [{ tableId: "t2", start: new Date("2026-11-12T19:00:00Z"), end: new Date("2026-11-12T20:45:00Z") }];
    const slots = computeAvailability(base({ busy, bufferMinutes: 15, tables: [tables[0]] }));
    const at = (h: string) => slots.find((s) => hm(s.startsAt) === h)!;
    expect(at("12:00").available).toBe(true);
    expect(at("19:00").available).toBe(false);
    expect(at("20:30").available).toBe(false); // commence avant 20:45
    expect(at("21:00").available).toBe(true);
    // la nouvelle réservation garde son propre tampon : 12:00 bloque jusqu'à 13:45
    const busyLunch = [{ tableId: "t2", start: new Date("2026-11-12T13:40:00Z"), end: new Date("2026-11-12T14:40:00Z") }];
    const lunch = computeAvailability(base({ busy: busyLunch, bufferMinutes: 15, tables: [tables[0]] }));
    expect(lunch.find((s) => hm(s.startsAt) === "12:00")!.available).toBe(false);
    expect(computeAvailability(base({ busy: busyLunch, bufferMinutes: 0, tables: [tables[0]] })).find((s) => hm(s.startsAt) === "12:00")!.available).toBe(true);
  });
  it("bornes [) : une fin à 20:30 n'empêche pas un début à 20:30", () => {
    const busy = [{ tableId: "t2", start: new Date("2026-11-12T19:00:00Z"), end: new Date("2026-11-12T20:30:00Z") }];
    const s = computeAvailability(base({ busy, tables: [tables[0]] })).find((x) => hm(x.startsAt) === "20:30")!;
    expect(s.available).toBe(true);
  });
  it("délai minimal et créneaux passés", () => {
    const slots = computeAvailability(base({ now: new Date("2026-11-12T12:10:00Z"), minNoticeMinutes: 60 }));
    expect(slots.filter((s) => s.reason === "past").map((s) => hm(s.startsAt))).toEqual(["12:00", "12:30", "13:00"]);
    expect(slots.find((s) => hm(s.startsAt) === "13:30")!.available).toBe(true);
  });
  it("fenêtre de réservation", () => {
    expect(computeAvailability(base({ now: new Date("2026-10-01T08:00:00Z"), bookingWindowDays: 30 }))).toEqual([]);
    expect(computeAvailability(base({ now: new Date("2026-10-13T08:00:00Z"), bookingWindowDays: 30 })).length).toBeGreaterThan(0);
  });
  it("capacité minimale d'une table respectée pour une table seule", () => {
    const t = [{ id: "big", label: "Grande", capacity: 10, minCapacity: 6 }, { id: "t4", label: "T4", capacity: 4 }];
    expect(pickTables(t, 2, () => true)!.map((x) => x.id)).toEqual(["t4"]);
    expect(pickTables(t, 7, () => true)!.map((x) => x.id)).toEqual(["big"]);
    expect(pickTables([t[0]], 2, () => true)).toBeNull();
  });
});

describe("réservations : divers", () => {
  it("transitions", () => {
    expect(canTransitionReservation("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransitionReservation("CONFIRMED", "SEATED")).toBe(true);
    expect(canTransitionReservation("SEATED", "COMPLETED")).toBe(true);
    expect(canTransitionReservation("SEATED", "CANCELLED")).toBe(false);
    expect(canTransitionReservation("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransitionReservation("NO_SHOW", "SEATED")).toBe(false);
  });
  it("code lisible", () => {
    const code = reservationCode(new Uint8Array([0, 1, 2, 3, 250]));
    expect(code).toHaveLength(5);
    expect([...code].every((c) => RESERVATION_CODE_ALPHABET.includes(c))).toBe(true);
    expect(RESERVATION_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });
  it("rappel la veille à 18 h locale (fuseau du restaurant)", () => {
    expect(iso(reminderInstant(new Date("2026-11-12T19:30:00Z"), LOME)!)).toBe("2026-11-11T18:00:00.000Z");
    // Paris en été : 18:00 locale = 16:00 UTC ; réservation à 00:30 locale le 2 juillet → veille = 1er juillet
    expect(iso(reminderInstant(new Date("2026-07-01T22:30:00Z"), PARIS)!)).toBe("2026-07-01T16:00:00.000Z");
  });
  it("validation : chevauchement de plages refusé, téléphone vérifié", () => {
    const bad = openingHoursSchema.safeParse({ ranges: [{ weekday: 1, opensAt: "12:00", closesAt: "15:00" }, { weekday: 1, opensAt: "14:00", closesAt: "16:00" }] });
    expect(bad.success).toBe(false);
    const night = openingHoursSchema.safeParse({ ranges: [{ weekday: 1, opensAt: "20:00", closesAt: "02:00" }, { weekday: 1, opensAt: "12:00", closesAt: "15:00" }] });
    expect(night.success).toBe(true);
    expect(publicReservationSchema.safeParse({ guestName: "Afi", guestPhone: "abc", partySize: 2, startsAt: "2026-11-12T19:00:00Z" }).success).toBe(false);
    expect(publicReservationSchema.safeParse({ guestName: "Afi", guestPhone: "90 12 34 56", partySize: 2, startsAt: "2026-11-12T19:00:00Z" }).success).toBe(true);
  });
});
