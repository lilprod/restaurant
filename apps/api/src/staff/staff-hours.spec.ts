import { computeHours, grossPay, rangesOverlap, shiftLocalDays, splitByWeek, weekBounds, weekStartOf, zonedDayRange } from "@restaurant/utils";
import { kioskCodeSchema } from "@restaurant/validation";

const LOME = "Africa/Lome"; // UTC, sans changement d'heure
const PARIS = "Europe/Paris";
const d = (s: string) => new Date(s);
const att = (a: string, b: string, brk = 0) => ({ clockIn: d(a), clockOut: d(b), breakMinutes: brk });

describe("personnel : semaines", () => {
  it("début de semaine selon le premier jour", () => {
    expect(weekStartOf("2026-11-18", 1)).toBe("2026-11-16"); // mercredi → lundi
    expect(weekStartOf("2026-11-22", 1)).toBe("2026-11-16"); // dimanche → lundi précédent
    expect(weekStartOf("2026-11-22", 0)).toBe("2026-11-22"); // semaine commençant le dimanche
    expect(weekStartOf("2026-11-21", 6)).toBe("2026-11-21");
  });
  it("bornes d'une semaine locale (fuseau Paris, hiver)", () => {
    const { start, end } = weekBounds("2026-11-16", PARIS);
    expect(start.toISOString()).toBe("2026-11-15T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-22T23:00:00.000Z");
  });
  it("la semaine du changement d'heure dure 7 jours locaux (167 h)", () => {
    const { start, end } = weekBounds("2026-03-23", PARIS); // passage à l'heure d'été le 29 mars
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(167);
  });
  it("chevauchement : bout à bout autorisé", () => {
    expect(rangesOverlap(d("2026-11-16T08:00Z"), d("2026-11-16T12:00Z"), d("2026-11-16T12:00Z"), d("2026-11-16T16:00Z"))).toBe(false);
    expect(rangesOverlap(d("2026-11-16T08:00Z"), d("2026-11-16T12:01Z"), d("2026-11-16T12:00Z"), d("2026-11-16T16:00Z"))).toBe(true);
  });
  it("copie de semaine : garde l'heure murale malgré le changement d'heure", () => {
    const monday = d("2026-03-23T17:00:00Z"); // 18:00 à Paris (heure d'hiver)
    const next = shiftLocalDays(monday, 7, PARIS); // lundi 30 mars : heure d'été → 18:00 locales = 16:00 UTC
    expect(next.toISOString()).toBe("2026-03-30T16:00:00.000Z");
  });
});

describe("personnel : découpe d'un pointage à cheval sur deux semaines", () => {
  it("coupe à minuit le dimanche soir et répartit la pause au prorata", () => {
    // dimanche 22/11 20:00 → lundi 23/11 04:00 (8 h), pause 60 min : 4 h de chaque côté
    const s = splitByWeek(d("2026-11-22T20:00:00Z"), d("2026-11-23T04:00:00Z"), 60, LOME);
    expect(s.map((x) => [x.week, x.minutes])).toEqual([["2026-11-16", 210], ["2026-11-23", 210]]);
  });
  it("fuseau : minuit local et non minuit UTC", () => {
    // Paris (UTC+1) : dimanche 22:30 UTC = 23:30 locale → la coupure tombe à 23:00 UTC
    const s = splitByWeek(d("2026-11-22T22:30:00Z"), d("2026-11-23T01:30:00Z"), 0, PARIS);
    expect(s.map((x) => [x.week, x.minutes])).toEqual([["2026-11-16", 30], ["2026-11-23", 150]]);
  });
  it("une pause de 0 minute ou un pointage nul ne donne rien", () => {
    expect(splitByWeek(d("2026-11-16T08:00Z"), d("2026-11-16T08:00Z"), 0, LOME)).toEqual([]);
  });
});

describe("personnel : heures normales et supplémentaires", () => {
  const T = 40 * 60;
  const week = { from: d("2026-11-16T00:00Z"), to: d("2026-11-23T00:00Z") };

  it("sous le seuil : tout est normal", () => {
    const h = computeHours([att("2026-11-16T08:00Z", "2026-11-16T16:00Z", 30)], week, LOME, T);
    expect(h).toMatchObject({ normalMinutes: 450, overtimeMinutes: 0 });
  });
  it("au-delà de 40 h dans la semaine : le surplus est supplémentaire", () => {
    const days = ["16", "17", "18", "19", "20", "21"].map((n) => att(`2026-11-${n}T08:00Z`, `2026-11-${n}T16:30Z`, 30)); // 6 × 8 h = 48 h
    const h = computeHours(days, week, LOME, T);
    expect(h.normalMinutes).toBe(40 * 60);
    expect(h.overtimeMinutes).toBe(8 * 60);
  });
  it("le seuil s'applique par semaine, pas sur la période : deux semaines de 30 h n'ont aucune heure sup.", () => {
    const rows = [16, 17, 18].map((n) => att(`2026-11-${n}T08:00Z`, `2026-11-${n}T18:00Z`)).concat([23, 24, 25].map((n) => att(`2026-11-${n}T08:00Z`, `2026-11-${n}T18:00Z`)));
    const h = computeHours(rows, { from: d("2026-11-16T00:00Z"), to: d("2026-11-30T00:00Z") }, LOME, T);
    expect(h).toMatchObject({ normalMinutes: 60 * 60, overtimeMinutes: 0 });
    expect(h.weeks).toHaveLength(2);
  });
  it("semaine à cheval : la nuit du dimanche au lundi compte pour les deux semaines", () => {
    // 5 × 8 h du lundi au vendredi (40 h) + dimanche 22:00 → lundi 06:00 (8 h : 2 h semaine 1, 6 h semaine 2)
    const rows = [16, 17, 18, 19, 20].map((n) => att(`2026-11-${n}T08:00Z`, `2026-11-${n}T16:00Z`)).concat([att("2026-11-22T22:00Z", "2026-11-23T06:00Z")]);
    const h = computeHours(rows, { from: d("2026-11-16T00:00Z"), to: d("2026-11-30T00:00Z") }, LOME, T);
    expect(h.weeks).toEqual([
      { week: "2026-11-16", normalMinutes: 40 * 60, overtimeMinutes: 2 * 60 },
      { week: "2026-11-23", normalMinutes: 6 * 60, overtimeMinutes: 0 },
    ]);
  });
  it("période qui coupe une semaine : le cumul de la semaine précède la période", () => {
    // 45 h dans la semaine (5 × 9 h) ; la période ne couvre que jeudi–vendredi (les 2 derniers jours = 18 h, dont 5 h sup.)
    const rows = [16, 17, 18, 19, 20].map((n) => att(`2026-11-${n}T08:00Z`, `2026-11-${n}T17:00Z`));
    const h = computeHours(rows, { from: d("2026-11-19T00:00Z"), to: d("2026-11-21T00:00Z") }, LOME, T);
    expect(h).toMatchObject({ normalMinutes: 13 * 60, overtimeMinutes: 5 * 60 });
  });
  it("ignore un pointage encore ouvert et applique le fuseau local pour l'appartenance à la période", () => {
    const open = { clockIn: d("2026-11-17T08:00Z"), clockOut: null, breakMinutes: 0 };
    expect(computeHours([open], week, LOME, T).normalMinutes).toBe(0);
    // Paris : lundi 23/11 00:30 locale = dimanche 22 23:30 UTC → semaine du 23 (locale), hors période de la semaine du 16
    const late = att("2026-11-22T23:30:00Z", "2026-11-23T02:30:00Z");
    const p = { from: zonedDayRange("2026-11-16", PARIS).start, to: zonedDayRange("2026-11-22", PARIS).end };
    expect(computeHours([late], p, PARIS, T).normalMinutes).toBe(0);
  });
  it("brut estimé : FCFA entiers, heures sup. majorées", () => {
    expect(grossPay(40 * 60, 8 * 60, 1000, 1.25)).toBe(40_000 + 10_000);
    expect(grossPay(7 * 60 + 20, 0, 1500, 1.25)).toBe(11_000); // 7 h 20 × 1 500
    expect(grossPay(1, 0, 1000, 1.25)).toBe(17); // arrondi à l'entier
  });
});

describe("personnel : code de pointage", () => {
  it("accepte 4 à 6 chiffres non triviaux", () => {
    for (const code of ["4821", "90417", "730518"]) expect(kioskCodeSchema.safeParse({ code }).success).toBe(true);
  });
  it("refuse les codes trop courts, non numériques, répétés ou en suite", () => {
    for (const code of ["123", "1234567", "48a1", "1111", "1234", "4321", "56789"]) expect(kioskCodeSchema.safeParse({ code }).success).toBe(false);
  });
});
