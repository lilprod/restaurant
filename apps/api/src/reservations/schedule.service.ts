import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant } from "@prisma/client";
import { type OpeningRange, zonedDay, zonedDayRange } from "@restaurant/utils";
import type { ClosureInput, ListClosuresQuery, OpeningHoursInput, OperationsInput, ReservationsSettingsInput } from "@restaurant/validation";
import { PrismaService } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { reservationInclude, reservationView } from "./reservations.views";

/** Tout ce qu'il faut pour calculer des disponibilités dans un restaurant. */
export interface BookingContext {
  tenant: Tenant;
  ops: OperationsInput;
  rs: ReservationsSettingsInput;
  hours: OpeningRange[];
  closures: { date: string; reason: string | null }[];
}

/** Horaires d'ouverture (plusieurs plages par jour) et fermetures exceptionnelles. */
@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: PrismaService, private readonly settings: TenantSettingsService) {}

  async context(tenantId: string, tenant?: Tenant): Promise<BookingContext> {
    const t = tenant ?? (await this.settings.tenant(tenantId));
    const [ops, rs, data] = await Promise.all([
      this.settings.getSection("operations", t),
      this.settings.getSection("reservations", t),
      this.prisma.asTenant(tenantId, async (tx) => ({
        hours: await tx.openingHours.findMany({ where: { tenantId } }),
        // fermetures à partir de la veille (plages après minuit) ; les plus anciennes ne servent plus
        closures: await tx.closureDay.findMany({ where: { tenantId, date: { gte: zonedDay(new Date(Date.now() - 2 * 86_400_000), t.timezone) } } }),
      })),
    ]);
    return {
      tenant: t, ops, rs,
      hours: data.hours.map((h) => ({ weekday: h.weekday, opensAt: h.opensAt, closesAt: h.closesAt, slotMinutes: h.slotMinutes })),
      closures: data.closures.map((c) => ({ date: c.date, reason: c.reason })),
    };
  }

  // ── Horaires ──

  async hours(tenantId: string) {
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.openingHours.findMany({ where: { tenantId }, orderBy: [{ weekday: "asc" }, { opensAt: "asc" }] }));
    return { ranges: rows.map(({ weekday, opensAt, closesAt, slotMinutes }) => ({ weekday, opensAt, closesAt, slotMinutes })) };
  }

  /** Remplace toutes les plages (la semaine entière est envoyée). */
  async setHours(acc: Account, input: OpeningHoursInput) {
    const tenantId = acc.tenantId!;
    const t = await this.settings.tenant(tenantId);
    const ops: OperationsInput = await this.settings.getSection("operations", t);
    await this.prisma.asTenant(tenantId, async (tx) => {
      await tx.openingHours.deleteMany({ where: { tenantId } });
      await tx.openingHours.createMany({
        data: input.ranges.map((r) => ({ tenantId, weekday: r.weekday, opensAt: r.opensAt, closesAt: r.closesAt, slotMinutes: r.slotMinutes ?? ops.reservationSlotMinutes })),
      });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "reservations.hours.update", entity: "OpeningHours", metadata: { ranges: input.ranges.length } } });
    });
    return this.hours(tenantId);
  }

  // ── Fermetures exceptionnelles ──

  async closures(tenantId: string, q: ListClosuresQuery) {
    const t = await this.settings.tenant(tenantId);
    const from = q.from ?? zonedDay(new Date(), t.timezone);
    return this.prisma.asTenant(tenantId, (tx) => tx.closureDay.findMany({
      where: { tenantId, date: { gte: from, ...(q.to ? { lte: q.to } : {}) } }, orderBy: { date: "asc" },
      select: { id: true, date: true, reason: true, createdAt: true },
    }));
  }

  /** Ajoute une fermeture ; renvoie aussi les réservations actives de ce jour (à prévenir ou déplacer). */
  async addClosure(acc: Account, input: ClosureInput) {
    const tenantId = acc.tenantId!;
    const t = await this.settings.tenant(tenantId);
    const { start, end } = zonedDayRange(input.date, t.timezone);
    return this.prisma.asTenant(tenantId, async (tx) => {
      if (await tx.closureDay.findFirst({ where: { tenantId, date: input.date } })) throw new ConflictException("Ce jour est déjà marqué comme fermé");
      const closure = await tx.closureDay.create({ data: { tenantId, date: input.date, reason: input.reason }, select: { id: true, date: true, reason: true, createdAt: true } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "reservations.closure.create", entity: "ClosureDay", entityId: closure.id, metadata: { date: input.date } } });
      const affected = await tx.reservation.findMany({
        where: { tenantId, startsAt: { gte: start, lt: end }, status: { in: ["PENDING", "CONFIRMED"] } },
        orderBy: { startsAt: "asc" }, include: reservationInclude,
      });
      return { ...closure, affectedReservations: affected.map(reservationView) };
    });
  }

  async removeClosure(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const c = await tx.closureDay.findFirst({ where: { id, tenantId } });
      if (!c) throw new NotFoundException("Fermeture introuvable");
      await tx.closureDay.delete({ where: { id } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "reservations.closure.delete", entity: "ClosureDay", entityId: id, metadata: { date: c.date } } });
    });
  }
}
