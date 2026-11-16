import type { Reservation } from "@restaurant/api-client";
import { describe, expect, it } from "vitest";
import { fitScale, freeSpot, nextLabel, nextReservationFor, overlappingIds, reshape, rotate, snapPosition, tileState } from "../floor-geometry";

const entry = (id: string, posX: number, posY: number, extra: object = {}) => ({ id, posX, posY, width: 90, height: 90, shape: "round" as const, rotation: 0, ...extra });
const plan = { width: 1000, height: 700 };

describe("plan de salle : géométrie", () => {
  it("aimante à la grille et garde la table dans la salle", () => {
    expect(snapPosition(143, 98, { width: 90, height: 90 }, plan)).toEqual({ posX: 140, posY: 100 });
    expect(snapPosition(-50, 900, { width: 90, height: 90 }, plan)).toEqual({ posX: 0, posY: 610 });
    expect(snapPosition(990, 5, { width: 140, height: 90 }, plan)).toEqual({ posX: 860, posY: 10 });
  });
  it("change de forme en gardant des proportions cohérentes", () => {
    expect(reshape(entry("a", 0, 0), "rect")).toMatchObject({ shape: "rect", width: 135, height: 90 });
    expect(reshape(entry("a", 0, 0, { shape: "rect", width: 150, height: 90 }), "square")).toMatchObject({ shape: "square", width: 100, height: 100 });
    expect(reshape(entry("a", 0, 0), "round")).toEqual(entry("a", 0, 0));
  });
  it("pivote modulo 360", () => {
    expect(rotate(350, 15)).toBe(5);
    expect(rotate(0, -15)).toBe(345);
  });
  it("repère les chevauchements", () => {
    const ids = overlappingIds([entry("a", 0, 0), entry("b", 80, 80), entry("c", 300, 300)]);
    expect([...ids].sort()).toEqual(["a", "b"]);
    expect(overlappingIds([entry("a", 0, 0), entry("b", 90, 0)]).size).toBe(0);
  });
  it("propose le libellé suivant et un emplacement libre", () => {
    expect(nextLabel(["T1", "T9", "Terrasse", "t10"])).toBe("T11");
    expect(nextLabel([])).toBe("T1");
    expect(freeSpot([entry("a", 40, 40)], { width: 90, height: 90 }, plan)).toEqual({ posX: 150, posY: 40 });
  });
  it("échelle d'affichage bornée", () => {
    expect(fitScale(500, 1000)).toBe(0.5);
    expect(fitScale(3000, 1000)).toBe(1.5);
    expect(fitScale(0, 1000)).toBe(1);
  });
});

const now = Date.parse("2026-11-16T18:00:00Z");
const res = (id: string, status: Reservation["status"], startMin: number, tableId = "t1"): Reservation => ({
  id, status, tables: [{ id: tableId, label: "T1", capacity: 4 }],
  startsAt: new Date(now + startMin * 60_000).toISOString(), endsAt: new Date(now + (startMin + 90) * 60_000).toISOString(),
} as Reservation);

describe("plan de salle : états", () => {
  it("la réservation proche et active est retenue, la plus tôt d'abord", () => {
    const list = [res("far", "CONFIRMED", 180), res("seated", "SEATED", 10), res("b", "PENDING", 45), res("a", "CONFIRMED", 20), res("other", "CONFIRMED", 5, "t2")];
    expect(nextReservationFor(["t1"], list, now)?.id).toBe("a");
    expect(nextReservationFor(["t1", "t2"], list, now)?.id).toBe("other");
    expect(nextReservationFor(["t3"], list, now)).toBeNull();
    expect(nextReservationFor(["t1"], [res("late", "CONFIRMED", -20)], now)?.id).toBe("late");
    expect(nextReservationFor(["t1"], [res("over", "CONFIRMED", -120)], now)).toBeNull();
  });
  it("état d'une tuile : occupée > à débarrasser > réservée bientôt > libre", () => {
    const soon = res("a", "CONFIRMED", 20);
    expect(tileState({ status: "FREE", openOrders: [] }, null)).toBe("free");
    expect(tileState({ status: "FREE", openOrders: [] }, soon)).toBe("soon");
    expect(tileState({ status: "CLEANING", openOrders: [] }, soon)).toBe("cleaning");
    expect(tileState({ status: "OCCUPIED", openOrders: [] }, soon)).toBe("occupied");
  });
});
