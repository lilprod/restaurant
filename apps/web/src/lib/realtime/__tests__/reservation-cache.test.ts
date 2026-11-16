import type { Reservation, WaitlistEntry } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { tenantKeys } from "../../tenant-keys";
import { applyReservationEvent, applyReservationToList, applyWaitlistEvent, localDay } from "../reservation-cache";

const root = ["tenant", "demo"] as const;
const res = (id: string, startsAt: string, over: Partial<Reservation> = {}): Reservation => ({
  id, code: id.toUpperCase(), status: "CONFIRMED", source: "PHONE", guestName: "Ama", guestPhone: null, guestEmail: null, partySize: 2,
  startsAt, endsAt: startsAt, durationMinutes: 90, tables: [], specialRequests: null, notes: null, overrideReason: null, orderId: null,
  noShowSuggested: false, confirmedAt: null, seatedAt: null, completedAt: null, cancelledAt: null, cancelReason: null, noShowAt: null,
  reminderSentAt: null, createdAt: startsAt, updatedAt: startsAt, ...over,
});
const wl = (id: string, status: WaitlistEntry["status"]): WaitlistEntry => ({
  id, status, guestName: "Kofi", guestPhone: null, guestEmail: null, partySize: 3, desiredAt: "2026-11-14T19:00:00.000Z",
  notes: null, notifiedAt: null, reservationId: null, createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
});

describe("reservation-cache", () => {
  it("calcule le jour local du restaurant", () => {
    expect(localDay("2026-11-14T23:30:00.000Z", "Africa/Lome")).toBe("2026-11-14");
    expect(localDay("2026-11-14T23:30:00.000Z", "Africa/Lagos")).toBe("2026-11-15");
  });

  it("insère trié, remplace, puis retire quand la réservation change de jour", () => {
    const q = { date: "2026-11-14" };
    let list = [res("b", "2026-11-14T20:00:00.000Z")];
    list = applyReservationToList(list, res("a", "2026-11-14T18:00:00.000Z"), q, "Africa/Lome");
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    list = applyReservationToList(list, res("a", "2026-11-14T18:00:00.000Z", { status: "SEATED" }), q, "Africa/Lome");
    expect(list[0]!.status).toBe("SEATED");
    list = applyReservationToList(list, res("a", "2026-11-15T18:00:00.000Z"), q, "Africa/Lome");
    expect(list.map((r) => r.id)).toEqual(["b"]);
  });

  it("ignore une réservation d'un autre jour et gère les intervalles", () => {
    expect(applyReservationToList([], res("x", "2026-11-20T18:00:00.000Z"), { date: "2026-11-14" }, "Africa/Lome")).toEqual([]);
    const q = { from: "2026-11-14T17:00:00.000Z", to: "2026-11-14T19:00:00.000Z" };
    expect(applyReservationToList([], res("x", "2026-11-14T18:00:00.000Z"), q, "Africa/Lome")).toHaveLength(1);
    expect(applyReservationToList([], res("y", "2026-11-14T19:00:00.000Z"), q, "Africa/Lome")).toHaveLength(0);
  });

  it("met à jour détail et listes du cache, sans toucher aux autres jours", () => {
    const qc = new QueryClient();
    qc.setQueryData(tenantKeys.reservationList(root, { date: "2026-11-14" }), [] as Reservation[]);
    qc.setQueryData(tenantKeys.reservationList(root, { date: "2026-11-15" }), [] as Reservation[]);
    applyReservationEvent(qc, root, res("a", "2026-11-14T18:00:00.000Z"));
    expect(qc.getQueryData<Reservation[]>(tenantKeys.reservationList(root, { date: "2026-11-14" }))).toHaveLength(1);
    expect(qc.getQueryData<Reservation[]>(tenantKeys.reservationList(root, { date: "2026-11-15" }))).toHaveLength(0);
    expect(qc.getQueryData(tenantKeys.reservation(root, "a"))).toBeTruthy();
  });

  it("liste d'attente : ajoute, remplace, retire à la conversion", () => {
    const qc = new QueryClient();
    const key = tenantKeys.waitlist(root, {});
    qc.setQueryData(key, [] as WaitlistEntry[]);
    applyWaitlistEvent(qc, root, wl("w1", "WAITING"));
    applyWaitlistEvent(qc, root, wl("w1", "NOTIFIED"));
    expect(qc.getQueryData<WaitlistEntry[]>(key)).toMatchObject([{ id: "w1", status: "NOTIFIED" }]);
    applyWaitlistEvent(qc, root, wl("w1", "CONVERTED"));
    expect(qc.getQueryData<WaitlistEntry[]>(key)).toEqual([]);
  });
});
