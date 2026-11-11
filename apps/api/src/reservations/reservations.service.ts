import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, ReservationStatus, Tenant } from "@prisma/client";
import {
  type AvailabilityTable, type BusyInterval, type ReservationState,
  addDays, canTransitionReservation, computeAvailability, fitsOpening, isTableFree, openingWindows, overlaps, pickTables, reservationCode,
  slotStarts, zonedDay, zonedDayRange,
} from "@restaurant/utils";
import type {
  AvailabilityQuery, CancelReservationInput, CreateReservationInput, ListReservationsQuery, PublicAvailabilityQuery, PublicReservationInput,
  PublicUpdateReservationInput, UpdateReservationInput,
} from "@restaurant/validation";
import { createHash, randomBytes } from "node:crypto";
import { APP_ENV, Env } from "../config/env";
import { NotificationsService } from "../notifications/notifications.service";
import type { TemplateDataMap, TemplateName } from "../notifications/templates";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { isManager } from "../restaurant/common";
import { TablesService } from "../restaurant/tables.service";
import type { Account } from "../security/accounts.repo";
import { LicenseGateService } from "../security/license-gate.service";
import { BookingContext, ScheduleService } from "./schedule.service";
import {
  ReservationRow, ReservationView, publicReservationView, reservationInclude, reservationView, waitlistView,
} from "./reservations.views";

const MIN = 60_000;
/** Arrivée en avance : installation possible jusqu'à 60 minutes avant l'heure prévue (la réservation est alors avancée). */
const SEAT_EARLY_MINUTES = 60;
const ACTIVE: ReservationStatus[] = ["PENDING", "CONFIRMED", "SEATED"];
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Erreur de la contrainte d'exclusion `ReservationTable_no_overlap` (code PostgreSQL 23P01). */
export function isOverlapError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? "");
  const meta = JSON.stringify((e as { meta?: unknown })?.meta ?? {});
  return /ReservationTable_no_overlap|23P01|exclusion constraint/i.test(msg + meta);
}

type Mode = "staff" | "walkin" | "public";
interface Placement {
  partySize: number;
  start: Date;
  durationMinutes: number;
  /** Choix manuel. */
  tableIds?: string[];
  /** Tables à garder si elles conviennent encore (modification). */
  preferTableIds?: string[];
  excludeReservationId?: string;
  force?: boolean;
}

/** Réservations : disponibilités, attribution des tables, cycle de vie, espace public, notifications. */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly realtime: RealtimeService,
    private readonly tables: TablesService,
    private readonly notifications: NotificationsService,
    private readonly gate: LicenseGateService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  // ── Lecture ──

  async list(tenantId: string, q: ListReservationsQuery) {
    const ctx = await this.schedule.context(tenantId);
    let range: { gte?: Date; lt?: Date };
    if (q.from || q.to) range = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) };
    else {
      const { start, end } = zonedDayRange(q.date ?? zonedDay(new Date(), ctx.tenant.timezone), ctx.tenant.timezone);
      range = { gte: start, lt: end };
    }
    const s = q.search?.trim();
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.reservation.findMany({
      where: {
        tenantId, startsAt: range,
        ...(q.status ? { status: { in: q.status } } : {}),
        ...(s ? { OR: [{ guestName: { contains: s, mode: "insensitive" } }, { guestPhone: { contains: s.replace(/\s/g, "") } }, { code: s.toUpperCase() }] } : {}),
      },
      orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
      include: reservationInclude,
    }));
    return rows.map(reservationView);
  }

  async get(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => reservationView(await this.load(tx, tenantId, id)));
  }

  /** Créneaux d'une journée (salle) : tous les créneaux, avec tables proposées ou raison d'indisponibilité. */
  async availability(tenantId: string, q: AvailabilityQuery) {
    const ctx = await this.schedule.context(tenantId);
    const durationMinutes = q.durationMinutes ?? ctx.ops.reservationDurationMinutes;
    const { slots, windows, closure } = await this.compute(ctx, q.date, q.partySize, durationMinutes, { minNoticeMinutes: 0, exclude: q.excludeReservationId });
    return {
      date: q.date, timezone: ctx.tenant.timezone, partySize: q.partySize, durationMinutes,
      closed: windows.length === 0, closureReason: closure?.reason ?? null,
      openingWindows: windows.map((w) => ({ start: w.start, end: w.end })),
      slots: slots.map((s) => ({
        startsAt: s.startsAt, endsAt: s.endsAt, available: s.available, ...(s.reason ? { reason: s.reason } : {}),
        tables: s.tables.map(({ id, label, capacity }) => ({ id, label, capacity })),
      })),
    };
  }

  private async compute(ctx: BookingContext, day: string, partySize: number, durationMinutes: number, opts: { minNoticeMinutes: number; bookingWindowDays?: number; exclude?: string }) {
    const tz = ctx.tenant.timezone;
    const closures = ctx.closures.map((c) => c.date);
    const windows = openingWindows(day, tz, ctx.hours, closures, ctx.ops.reservationSlotMinutes);
    const closure = ctx.closures.find((c) => c.date === day);
    const from = zonedDayRange(day, tz).start;
    const to = new Date(zonedDayRange(day, tz).end.getTime() + 36 * 3_600_000);
    const { tables, busy } = await this.prisma.asTenant(ctx.tenant.id, async (tx) => this.occupancy(tx, ctx.tenant.id, from, to, opts.exclude));
    const slots = computeAvailability({
      day, timeZone: tz, hours: ctx.hours, closures, partySize, durationMinutes, bufferMinutes: ctx.rs.bufferMinutes,
      defaultSlotMinutes: ctx.ops.reservationSlotMinutes, tables, busy, now: new Date(),
      minNoticeMinutes: opts.minNoticeMinutes, bookingWindowDays: opts.bookingWindowDays,
    });
    return { slots, windows, closure };
  }

  /** Tables actives et occupations existantes (tampon compris) qui touchent [from, to). */
  private async occupancy(tx: Tx, tenantId: string, from: Date, to: Date, excludeReservationId?: string) {
    const tables: AvailabilityTable[] = await tx.restaurantTable.findMany({
      where: { tenantId, isActive: true }, select: { id: true, label: true, capacity: true, minCapacity: true },
    });
    const rows = await tx.reservationTable.findMany({
      where: { tenantId, active: true, startsAt: { lt: to }, endsAt: { gt: from }, ...(excludeReservationId ? { reservationId: { not: excludeReservationId } } : {}) },
      select: { tableId: true, startsAt: true, endsAt: true },
    });
    const busy: BusyInterval[] = rows.map((b) => ({ tableId: b.tableId, start: b.startsAt, end: b.endsAt }));
    return { tables, busy };
  }

  // ── Règles ──

  /** Taille du groupe, fermeture, horaires, délai, fenêtre de réservation (sauf forçage par un responsable). */
  private checkRules(ctx: BookingContext, p: { partySize: number; start: Date; durationMinutes: number; force?: boolean }, mode: Mode, checkTime = true) {
    if (p.force) return;
    if (p.partySize > ctx.ops.maxPartySize) {
      throw new BadRequestException({
        message: "Données invalides",
        errors: [{ path: "partySize", message: `${ctx.ops.maxPartySize} personnes maximum par réservation${mode === "public" ? " : appelez le restaurant pour un groupe" : ""}` }],
      });
    }
    if (mode === "walkin" || !checkTime) return;
    const tz = ctx.tenant.timezone;
    const now = Date.now();
    const day = zonedDay(p.start, tz);
    const closure = ctx.closures.find((c) => c.date === day);
    if (closure) throw new ConflictException(`Le restaurant est fermé ce jour-là${closure.reason ? ` (${closure.reason})` : ""}`);
    const closures = ctx.closures.map((c) => c.date);
    if (mode === "public") {
      if (p.start.getTime() < now + ctx.rs.minNoticeMinutes * MIN) {
        throw new ConflictException(`Réservez au moins ${ctx.rs.minNoticeMinutes} minutes à l'avance, ou appelez le restaurant`);
      }
      if (day > addDays(zonedDay(new Date(now), tz), ctx.rs.bookingWindowDays)) {
        throw new ConflictException(`Les réservations en ligne sont ouvertes ${ctx.rs.bookingWindowDays} jours à l'avance au plus`);
      }
      const starts = [addDays(day, -1), day].flatMap((d) => slotStarts(d, tz, ctx.hours, closures, p.durationMinutes, ctx.ops.reservationSlotMinutes));
      if (!starts.some((s) => s.getTime() === p.start.getTime())) {
        throw new ConflictException("Ce créneau n'est pas proposé : choisissez l'un des créneaux disponibles");
      }
    } else {
      if (p.start.getTime() < now - 15 * MIN) throw new ConflictException("Ce créneau est déjà passé");
      const windows = [addDays(day, -1), day].flatMap((d) => openingWindows(d, tz, ctx.hours, closures, ctx.ops.reservationSlotMinutes));
      if (!fitsOpening(p.start, p.durationMinutes, windows)) {
        throw new ConflictException("Le restaurant n'est pas ouvert sur toute la durée de ce créneau (un responsable peut forcer avec un motif)");
      }
    }
  }

  /**
   * Choisit les tables (manuel, tables actuelles si elles conviennent encore, sinon automatique) sous le verrou du restaurant.
   * Renvoie aussi la fin de la réservation et la fin d'occupation (tampon compris).
   */
  private async place(tx: Tx, ctx: BookingContext, p: Placement) {
    const tenantId = ctx.tenant.id;
    const end = new Date(p.start.getTime() + p.durationMinutes * MIN);
    const blocked = new Date(end.getTime() + ctx.rs.bufferMinutes * MIN);
    const { tables, busy } = await this.occupancy(tx, tenantId, p.start, blocked, p.excludeReservationId);
    const free = (t: AvailabilityTable) => isTableFree(t.id, p.start, blocked, busy);
    const capacity = (ts: AvailabilityTable[]) => ts.reduce((n, t) => n + t.capacity, 0);

    if (p.tableIds) {
      const chosen = [...new Set(p.tableIds)].map((id) => {
        const t = tables.find((x) => x.id === id);
        if (!t) throw new NotFoundException("Table introuvable");
        return t;
      });
      for (const t of chosen) {
        const clash = busy.find((b) => b.tableId === t.id && overlaps(p.start, blocked, b.start, b.end));
        if (clash) throw new ConflictException(`La table ${t.label} est déjà réservée de ${this.hm(clash.start, ctx)} à ${this.hm(clash.end, ctx)}`);
      }
      if (capacity(chosen) < p.partySize && !p.force) {
        throw new ConflictException(`Capacité insuffisante : ${capacity(chosen)} places pour ${p.partySize} personnes (un responsable peut forcer avec un motif)`);
      }
      return { tables: chosen, end, blocked };
    }
    if (p.preferTableIds?.length) {
      const current = tables.filter((t) => p.preferTableIds!.includes(t.id));
      if (current.length === p.preferTableIds.length && current.every(free) && capacity(current) >= p.partySize) return { tables: current, end, blocked };
    }
    const picked = pickTables(tables, p.partySize, free);
    if (!picked) throw new ConflictException("Plus de table disponible sur ce créneau");
    return { tables: picked, end, blocked };
  }

  // ── Création ──

  async create(acc: Account, input: CreateReservationInput, hooks: { afterCreate?: (tx: Tx, reservationId: string) => Promise<void> } = {}) {
    const tenantId = acc.tenantId!;
    if (input.force && !isManager(acc)) throw new ForbiddenException("Seul un responsable peut forcer une réservation");
    const ctx = await this.schedule.context(tenantId);
    const walkIn = input.source === "WALK_IN";
    const start = input.startsAt ?? new Date();
    const durationMinutes = input.durationMinutes ?? ctx.ops.reservationDurationMinutes;
    this.checkRules(ctx, { partySize: input.partySize, start, durationMinutes, force: input.force }, walkIn ? "walkin" : "staff");
    const token = randomBytes(24).toString("base64url");

    const view = await this.write(tenantId, async (tx) => {
      const placed = await this.place(tx, ctx, { partySize: input.partySize, start, durationMinutes, tableIds: input.tableIds, force: input.force });
      const r = await tx.reservation.create({
        data: {
          tenantId, code: await this.newCode(tx, tenantId), manageTokenHash: hashToken(token), source: input.source,
          guestName: input.guestName, guestPhone: input.guestPhone, guestEmail: input.guestEmail, partySize: input.partySize,
          startsAt: start, endsAt: placed.end, status: "CONFIRMED", confirmedAt: new Date(), createdById: acc.id,
          specialRequests: input.specialRequests, notes: input.notes, overrideReason: input.force ? input.overrideReason : null,
          tables: { create: placed.tables.map((t) => ({ tenantId, tableId: t.id, startsAt: start, endsAt: placed.blocked })) },
        },
      });
      if (input.force) await this.audit(tx, tenantId, acc.id, "reservation.force", r.id, { reason: input.overrideReason, partySize: input.partySize });
      await hooks.afterCreate?.(tx, r.id);
      return reservationView(await this.load(tx, tenantId, r.id));
    });
    this.realtime.emit(tenantId, "reservation.created", view);
    if (!walkIn) await this.notify(ctx.tenant, view, "reservation.confirmed", { manageUrl: this.manageUrl(ctx.tenant, token) });
    return view;
  }

  // ── Modification ──

  async update(acc: Account, id: string, input: UpdateReservationInput) {
    const tenantId = acc.tenantId!;
    if (input.force && !isManager(acc)) throw new ForbiddenException("Seul un responsable peut forcer une réservation");
    const ctx = await this.schedule.context(tenantId);
    let changed: string[] = [];
    let notifyChange = false;
    const view = await this.mutate(tenantId, id, async (tx, r) => {
      if (!ACTIVE.includes(r.status)) throw new ConflictException("Cette réservation est close : elle ne peut plus être modifiée");
      const seated = r.status === "SEATED";
      if (seated && input.startsAt && input.startsAt.getTime() !== r.startsAt.getTime()) {
        throw new ConflictException("Les clients sont installés : l'heure d'arrivée ne peut plus changer");
      }
      const res = await this.reschedule(tx, ctx, r, {
        start: input.startsAt, durationMinutes: input.durationMinutes, partySize: input.partySize, tableIds: input.tableIds, force: input.force,
      }, "staff");
      changed = res.changedTables;
      notifyChange = res.timeChanged || res.partyChanged;
      await tx.reservation.update({
        where: { id: r.id },
        data: {
          guestName: input.guestName, guestPhone: input.guestPhone, guestEmail: input.guestEmail,
          specialRequests: input.specialRequests, notes: input.notes,
          ...(input.force ? { overrideReason: input.overrideReason } : {}),
        },
      });
      if (input.force) await this.audit(tx, tenantId, acc.id, "reservation.force", r.id, { reason: input.overrideReason });
    });
    await this.broadcastTables(tenantId, changed);
    if (notifyChange && view.status !== "SEATED") await this.notify(ctx.tenant, view, "reservation.updated", {});
    return view;
  }

  /**
   * Applique un changement d'heure, de durée, de taille ou de tables : nouvelle attribution (les tables actuelles sont
   * gardées si elles conviennent encore) puis réécriture des occupations. La contrainte d'exclusion reste l'arbitre.
   */
  private async reschedule(
    tx: Tx, ctx: BookingContext, r: ReservationRow,
    p: { start?: Date; durationMinutes?: number; partySize?: number; tableIds?: string[]; force?: boolean }, mode: Mode,
  ) {
    const tenantId = ctx.tenant.id;
    const curDuration = Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / MIN);
    const start = p.start ?? r.startsAt;
    const durationMinutes = p.durationMinutes ?? curDuration;
    const partySize = p.partySize ?? r.partySize;
    const timeChanged = start.getTime() !== r.startsAt.getTime() || durationMinutes !== curDuration;
    const partyChanged = partySize !== r.partySize;
    const currentIds = r.tables.map((t) => t.tableId);
    const tablesAsked = !!p.tableIds && (p.tableIds.length !== currentIds.length || p.tableIds.some((x) => !currentIds.includes(x)));
    if (!timeChanged && !partyChanged && !tablesAsked) return { timeChanged, partyChanged, changedTables: [] as string[] };

    if (partyChanged || (timeChanged && r.status !== "SEATED")) {
      this.checkRules(ctx, { partySize, start, durationMinutes, force: p.force }, mode, timeChanged && r.status !== "SEATED");
    }
    const placed = await this.place(tx, ctx, {
      partySize, start, durationMinutes, excludeReservationId: r.id, force: p.force,
      tableIds: tablesAsked ? p.tableIds : undefined, preferTableIds: currentIds,
    });
    await tx.reservationTable.deleteMany({ where: { reservationId: r.id } });
    await tx.reservationTable.createMany({ data: placed.tables.map((t) => ({ tenantId, reservationId: r.id, tableId: t.id, startsAt: start, endsAt: placed.blocked })) });
    await tx.reservation.update({
      where: { id: r.id },
      data: { startsAt: start, endsAt: placed.end, partySize, ...(timeChanged ? { reminderSentAt: null, noShowSuggestedAt: null } : {}) },
    });

    // Clients installés et tables changées : l'ancienne table se libère, la nouvelle est occupée.
    const newIds = placed.tables.map((t) => t.id);
    let changedTables: string[] = [];
    if (r.status === "SEATED") {
      const left = currentIds.filter((x) => !newIds.includes(x));
      const joined = newIds.filter((x) => !currentIds.includes(x));
      await tx.restaurantTable.updateMany({ where: { id: { in: joined }, tenantId }, data: { status: "OCCUPIED" } });
      for (const tid of left) await this.freeTable(tx, tenantId, tid);
      changedTables = [...left, ...joined];
    }
    return { timeChanged, partyChanged, changedTables };
  }

  // ── Cycle de vie ──

  async confirm(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    const view = await this.mutate(tenantId, id, async (tx, r) => {
      this.assertTransition(r.status, "CONFIRMED");
      await tx.reservation.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
    });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await this.notify(tenant, view, "reservation.updated", { confirmedNow: true });
    return view;
  }

  /** Installe les clients : table(s) occupée(s). Arrivée en avance : la réservation est avancée (si la table est libre). */
  async seat(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    let tableIds: string[] = [];
    const view = await this.mutate(tenantId, id, async (tx, r) => {
      this.assertTransition(r.status, "SEATED");
      if (Date.now() < r.startsAt.getTime() - SEAT_EARLY_MINUTES * MIN) {
        throw new ConflictException(`Trop tôt pour installer cette réservation : possible ${SEAT_EARLY_MINUTES} minutes avant l'heure prévue`);
      }
      tableIds = r.tables.map((t) => t.tableId);
      const busyOrder = await tx.order.findFirst({
        where: { tenantId, tableId: { in: tableIds }, closedAt: null, cancelledAt: null, OR: [{ reservationId: null }, { reservationId: { not: r.id } }] },
        include: { table: { select: { label: true } } },
      });
      if (busyOrder) throw new ConflictException(`La table ${busyOrder.table?.label} est encore occupée (commande n° ${busyOrder.number})`);
      const seatedHere = await tx.reservationTable.findFirst({
        where: { tenantId, tableId: { in: tableIds }, reservationId: { not: r.id }, reservation: { status: "SEATED" } },
        include: { table: { select: { label: true } } },
      });
      if (seatedHere) throw new ConflictException(`La table ${seatedHere.table.label} est encore occupée par une autre réservation`);

      const now = new Date();
      if (now < r.startsAt) {
        const shift = r.startsAt.getTime() - now.getTime();
        for (const t of r.tables) {
          await tx.reservationTable.update({
            where: { reservationId_tableId: { reservationId: r.id, tableId: t.tableId } },
            data: { startsAt: now, endsAt: new Date(t.endsAt.getTime() - shift) },
          });
        }
        await tx.reservation.update({ where: { id }, data: { startsAt: now, endsAt: new Date(r.endsAt.getTime() - shift) } });
      }
      await tx.reservation.update({ where: { id }, data: { status: "SEATED", seatedAt: now, ...(r.confirmedAt ? {} : { confirmedAt: now }) } });
      await tx.restaurantTable.updateMany({ where: { id: { in: tableIds }, tenantId }, data: { status: "OCCUPIED" } });
    }, "Une autre réservation occupe encore cette table avant l'heure prévue");
    await this.broadcastTables(tenantId, tableIds);
    return view;
  }

  /** Fin du repas : la table est libérée (sauf commande encore ouverte). */
  async complete(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    let tableIds: string[] = [];
    const view = await this.mutate(tenantId, id, async (tx, r) => {
      this.assertTransition(r.status, "COMPLETED");
      tableIds = r.tables.map((t) => t.tableId);
      await tx.reservation.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.reservationTable.updateMany({ where: { reservationId: id }, data: { active: false } });
      for (const tid of tableIds) await this.freeTable(tx, tenantId, tid);
    });
    await this.broadcastTables(tenantId, tableIds);
    return view;
  }

  async cancel(acc: Account | null, tenantId: string, id: string, input: CancelReservationInput & { byGuest?: boolean }) {
    const view = await this.mutate(tenantId, id, async (tx, r) => {
      this.assertTransition(r.status, "CANCELLED");
      const reason = input.reason ?? (input.byGuest ? "Annulée par le client" : null);
      await tx.reservation.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
      await tx.reservationTable.updateMany({ where: { reservationId: id }, data: { active: false } });
      await this.audit(tx, tenantId, acc?.id ?? null, "reservation.cancel", id, { reason, byGuest: !!input.byGuest });
    });
    if (input.notifyGuest) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      await this.notify(tenant, view, "reservation.cancelled", { reason: input.byGuest ? undefined : (input.reason ?? undefined) });
    }
    return { ...view, waitlistMatches: await this.waitlistMatches(tenantId, id) };
  }

  /** Client absent : possible à partir de l'heure prévue ; la table est libérée. */
  async noShow(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    return this.mutate(tenantId, id, async (tx, r) => {
      this.assertTransition(r.status, "NO_SHOW");
      if (Date.now() < r.startsAt.getTime()) throw new ConflictException("L'heure de la réservation n'est pas encore passée");
      await tx.reservation.update({ where: { id }, data: { status: "NO_SHOW", noShowAt: new Date() } });
      await tx.reservationTable.updateMany({ where: { reservationId: id }, data: { active: false } });
      await this.audit(tx, tenantId, acc.id, "reservation.no-show", id, {});
    });
  }

  /**
   * Entrées de la liste d'attente compatibles avec une réservation annulée (ou libérée) : en attente ou prévenues,
   * heure souhaitée à moins d'une durée de repas du créneau libéré, groupe qui tient sur les tables libérées. Les plus anciennes d'abord.
   */
  async waitlistMatches(tenantId: string, id: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const r = await this.load(tx, tenantId, id);
      const span = Math.max(r.endsAt.getTime() - r.startsAt.getTime(), 30 * MIN);
      const capacity = r.tables.reduce((n, t) => n + t.table.capacity, 0);
      const rows = await tx.waitlistEntry.findMany({
        where: {
          tenantId, status: { in: ["WAITING", "NOTIFIED"] }, partySize: { lte: capacity },
          desiredAt: { gte: new Date(r.startsAt.getTime() - span), lte: new Date(r.startsAt.getTime() + span) },
        },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(waitlistView);
    });
  }

  // ── Espace public (sans compte) ──

  private async publicTenant(slug: string): Promise<Tenant> {
    const t = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!t) throw new NotFoundException("Restaurant introuvable");
    try { await this.gate.assertAccess(t.id); } catch { throw new NotFoundException("Réservations indisponibles"); }
    return t;
  }

  private assertOnline(ctx: BookingContext) {
    if (!ctx.ops.onlineReservations) {
      throw new ForbiddenException({ statusCode: 403, code: "RESERVATIONS_DISABLED", message: "Ce restaurant ne prend pas de réservations en ligne : appelez-le directement." });
    }
  }

  async publicAvailability(slug: string, q: PublicAvailabilityQuery) {
    const tenant = await this.publicTenant(slug);
    const ctx = await this.schedule.context(tenant.id, tenant);
    this.assertOnline(ctx);
    this.checkRules(ctx, { partySize: q.partySize, start: new Date(), durationMinutes: 0 }, "public", false);
    const durationMinutes = ctx.ops.reservationDurationMinutes;
    const { slots, windows, closure } = await this.compute(ctx, q.date, q.partySize, durationMinutes, {
      minNoticeMinutes: ctx.rs.minNoticeMinutes, bookingWindowDays: ctx.rs.bookingWindowDays,
    });
    return {
      date: q.date, timezone: ctx.tenant.timezone, partySize: q.partySize, durationMinutes,
      closed: windows.length === 0, closureReason: closure?.reason ?? null,
      slots: slots.filter((s) => s.available).map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })),
    };
  }

  async publicCreate(slug: string, input: PublicReservationInput) {
    const tenant = await this.publicTenant(slug);
    const ctx = await this.schedule.context(tenant.id, tenant);
    this.assertOnline(ctx);
    const durationMinutes = ctx.ops.reservationDurationMinutes;
    this.checkRules(ctx, { partySize: input.partySize, start: input.startsAt, durationMinutes }, "public");
    const token = randomBytes(24).toString("base64url");
    const pending = ctx.rs.requireConfirmation;
    const view = await this.write(tenant.id, async (tx) => {
      const placed = await this.place(tx, ctx, { partySize: input.partySize, start: input.startsAt, durationMinutes });
      const r = await tx.reservation.create({
        data: {
          tenantId: tenant.id, code: await this.newCode(tx, tenant.id), manageTokenHash: hashToken(token), source: "ONLINE",
          guestName: input.guestName, guestPhone: input.guestPhone, guestEmail: input.guestEmail, partySize: input.partySize,
          startsAt: input.startsAt, endsAt: placed.end, specialRequests: input.specialRequests,
          status: pending ? "PENDING" : "CONFIRMED", confirmedAt: pending ? null : new Date(),
          tables: { create: placed.tables.map((t) => ({ tenantId: tenant.id, tableId: t.id, startsAt: input.startsAt, endsAt: placed.blocked })) },
        },
      });
      return reservationView(await this.load(tx, tenant.id, r.id));
    });
    this.realtime.emit(tenant.id, "reservation.created", view);
    const manageUrl = this.manageUrl(tenant, token);
    await this.notify(tenant, view, pending ? "reservation.pending" : "reservation.confirmed", { manageUrl });
    return { code: view.code, status: view.status, manageToken: token, manageUrl, reservation: this.publicView(view, ctx) };
  }

  /** Réservation désignée par le jeton du lien de gestion (404 si inconnu). */
  private async byToken(token: string) {
    const found = await this.prisma.asPlatform((tx) => tx.reservation.findUnique({ where: { manageTokenHash: hashToken(token) }, select: { id: true, tenantId: true } }));
    if (!found) throw new NotFoundException("Réservation introuvable");
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: found.tenantId } });
    const ctx = await this.schedule.context(tenant.id, tenant);
    const view = await this.get(tenant.id, found.id);
    return { ctx, view };
  }

  private rights(view: Pick<ReservationView, "status" | "startsAt">, ctx: BookingContext) {
    const open = view.status === "PENDING" || view.status === "CONFIRMED";
    const now = Date.now();
    return {
      canCancel: open && view.startsAt.getTime() > now,
      canModify: open && view.startsAt.getTime() > now + ctx.rs.minNoticeMinutes * MIN,
    };
  }

  private publicView(view: ReservationView, ctx: BookingContext) {
    const t = ctx.tenant;
    return publicReservationView(view, { name: t.name, slug: t.slug, phone: t.phone, timezone: t.timezone }, this.rights(view, ctx));
  }

  async publicGet(token: string) {
    const { ctx, view } = await this.byToken(token);
    return this.publicView(view, ctx);
  }

  async publicUpdate(token: string, input: PublicUpdateReservationInput) {
    const { ctx, view: before } = await this.byToken(token);
    if (!this.rights(before, ctx).canModify) throw new ConflictException("Cette réservation ne peut plus être modifiée en ligne : appelez le restaurant");
    let notifyChange = false;
    const view = await this.mutate(ctx.tenant.id, before.id, async (tx, r) => {
      if (r.status !== "PENDING" && r.status !== "CONFIRMED") throw new ConflictException("Cette réservation ne peut plus être modifiée");
      const res = await this.reschedule(tx, ctx, r, { start: input.startsAt, partySize: input.partySize }, "public");
      notifyChange = res.timeChanged || res.partyChanged;
      if (input.specialRequests !== undefined) await tx.reservation.update({ where: { id: r.id }, data: { specialRequests: input.specialRequests } });
    });
    if (notifyChange) await this.notify(ctx.tenant, view, "reservation.updated", {});
    return this.publicView(view, ctx);
  }

  async publicCancel(token: string) {
    const { ctx, view } = await this.byToken(token);
    if (!this.rights(view, ctx).canCancel) throw new ConflictException("Cette réservation ne peut plus être annulée en ligne : appelez le restaurant");
    const res = await this.cancel(null, ctx.tenant.id, view.id, { notifyGuest: true, byGuest: true });
    return this.publicView(res, ctx);
  }

  // ── Notifications ──

  private manageUrl(tenant: Tenant, token: string) {
    return `${this.env.APP_URL}/r/${tenant.slug}/reservation/${token}`;
  }

  formatWhen(at: Date, timeZone: string) {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone }).format(at);
  }

  /** Prévient le client (email et/ou SMS selon les coordonnées connues ; canaux et préférences du restaurant respectés). */
  async notify<K extends "reservation.confirmed" | "reservation.pending" | "reservation.updated" | "reservation.cancelled" | "reservation.reminder">(
    tenant: Pick<Tenant, "id" | "timezone">,
    r: Pick<ReservationView, "id" | "code" | "guestName" | "guestEmail" | "guestPhone" | "partySize" | "startsAt">,
    template: K,
    extra: Partial<TemplateDataMap[K]>,
    dedupeKey?: string,
  ) {
    const data = { guestName: r.guestName, code: r.code, when: this.formatWhen(r.startsAt, tenant.timezone), partySize: r.partySize, ...extra } as TemplateDataMap[K];
    const results = [];
    if (r.guestEmail) results.push(await this.notifications.send({ channel: "EMAIL", to: r.guestEmail, template: template as TemplateName, data, tenantId: tenant.id, dedupeKey: dedupeKey && `${dedupeKey}:email` }));
    if (r.guestPhone) results.push(await this.notifications.send({ channel: "SMS", to: r.guestPhone, template: template as TemplateName, data, tenantId: tenant.id, dedupeKey: dedupeKey && `${dedupeKey}:sms` }));
    return results;
  }

  // ── interne ──

  private async load(tx: Tx, tenantId: string, id: string): Promise<ReservationRow> {
    const r = await tx.reservation.findFirst({ where: { id, tenantId }, include: reservationInclude });
    if (!r) throw new NotFoundException("Réservation introuvable");
    return r;
  }

  /**
   * Transaction d'écriture sous verrou consultatif du restaurant : les attributions de tables sont sérialisées
   * (la seconde de deux demandes simultanées voit la première). La contrainte d'exclusion reste l'arbitre final.
   */
  private async write<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, overlapMessage = "Cette table est déjà réservée sur ce créneau"): Promise<T> {
    try {
      return await this.prisma.asTenant(tenantId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reservations:${tenantId}`}))`;
        return fn(tx);
      });
    } catch (e) {
      if (isOverlapError(e)) throw new ConflictException(overlapMessage);
      throw e;
    }
  }

  /** Charge la réservation sous verrou, applique `fn`, puis diffuse `reservation.updated`. */
  private async mutate(tenantId: string, id: string, fn: (tx: Tx, r: ReservationRow) => Promise<void>, overlapMessage?: string) {
    const view = await this.write(tenantId, async (tx) => {
      await fn(tx, await this.load(tx, tenantId, id));
      return reservationView(await this.load(tx, tenantId, id));
    }, overlapMessage);
    this.realtime.emit(tenantId, "reservation.updated", view);
    return view;
  }

  private assertTransition(from: ReservationStatus, to: ReservationState) {
    if (!canTransitionReservation(from as ReservationState, to)) {
      const labels: Record<string, string> = {
        PENDING: "en attente", CONFIRMED: "confirmée", SEATED: "installée", COMPLETED: "terminée", CANCELLED: "annulée", NO_SHOW: "marquée absente",
      };
      throw new ConflictException(`Action impossible : la réservation est ${labels[from]}`);
    }
  }

  /** Libère une table si plus aucune commande n'y est ouverte. */
  private async freeTable(tx: Tx, tenantId: string, tableId: string) {
    const open = await tx.order.count({ where: { tenantId, tableId, closedAt: null, cancelledAt: null } });
    if (!open) await tx.restaurantTable.updateMany({ where: { id: tableId, tenantId, status: "OCCUPIED" }, data: { status: "FREE" } });
  }

  private async broadcastTables(tenantId: string, ids: string[]) {
    for (const id of new Set(ids)) await this.tables.broadcast(tenantId, id);
  }

  private async newCode(tx: Tx, tenantId: string) {
    for (let i = 0; i < 8; i++) {
      const code = reservationCode(randomBytes(8), i < 4 ? 5 : 6);
      if (!(await tx.reservation.findFirst({ where: { tenantId, code }, select: { id: true } }))) return code;
    }
    throw new ConflictException("Impossible de générer un code de réservation, réessayez");
  }

  private hm(at: Date, ctx: BookingContext) {
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: ctx.tenant.timezone }).format(at);
  }

  private audit(tx: Tx, tenantId: string, userId: string | null, action: string, entityId: string, metadata: Prisma.InputJsonValue) {
    return tx.auditLog.create({ data: { tenantId, userId, action, entity: "Reservation", entityId, metadata } });
  }
}
