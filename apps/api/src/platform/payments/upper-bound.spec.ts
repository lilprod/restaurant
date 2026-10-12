import { upperBound } from "./payments.service";

describe("filtre « jusqu'au » des paiements", () => {
  it("inclut toute la journée pour une date seule", () => {
    expect(upperBound(new Date("2026-10-12"))).toEqual({ lt: new Date("2026-10-13T00:00:00.000Z") });
  });
  it("garde une date-heure précise telle quelle", () => {
    const d = new Date("2026-10-12T23:59:59.000Z");
    expect(upperBound(d)).toEqual({ lte: d });
  });
});
