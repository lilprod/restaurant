import { zonedDay, zonedDayRange, zonedHour } from "@restaurant/utils";

describe("journées dans le fuseau du restaurant", () => {
  it("Lomé (UTC+0)", () => {
    expect(zonedDayRange("2026-10-12", "Africa/Lome")).toEqual({
      start: new Date("2026-10-12T00:00:00Z"), end: new Date("2026-10-13T00:00:00Z"),
    });
  });
  it("Paris en été (UTC+2) et changement d'heure (journée de 25 h)", () => {
    expect(zonedDayRange("2026-07-01", "Europe/Paris").start.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    const r = zonedDayRange("2026-10-25", "Europe/Paris");
    expect((r.end.getTime() - r.start.getTime()) / 3_600_000).toBe(25);
  });
  it("jour et heure locaux d'un instant", () => {
    const at = new Date("2026-10-12T23:30:00Z");
    expect(zonedDay(at, "Africa/Lome")).toBe("2026-10-12");
    expect(zonedDay(at, "Africa/Lagos")).toBe("2026-10-13");   // UTC+1
    expect(zonedHour(at, "Africa/Lagos")).toBe(0);
  });
});
