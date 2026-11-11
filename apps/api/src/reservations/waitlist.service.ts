import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { WaitlistStatus } from "@prisma/client";
import { zonedDayRange } from "@restaurant/utils";
import type { ConvertWaitlistInput, ListWaitlistQuery, WaitlistInput } from "@restaurant/validation";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { Account } from "../security/accounts.repo";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { ReservationsService } from "./reservations.service";
import { WaitlistRow, waitlistView } from "./reservations.views";

const OPEN: WaitlistStatus[] = ["WAITING", "NOTIFIED"];

/** Liste d'attente : inscription, message « place libérée », conversion en réservation, retrait. */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(tenantId: string, q: ListWaitlistQuery) {
    const t = await this.settings.tenant(tenantId);
    const range = q.date ? zonedDayRange(q.date, t.timezone) : null;
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.waitlistEntry.findMany({
      where: {
        tenantId,
        status: q.status ? q.status : { in: OPEN },
        ...(range ? { desiredAt: { gte: range.start, lt: range.end } } : {}),
      },
      orderBy: [{ desiredAt: "asc" }, { createdAt: "asc" }],
    }));
    return rows.map(waitlistView);
  }

  async create(acc: Account, input: WaitlistInput) {
    const tenantId = acc.tenantId!;
    const row = await this.prisma.asTenant(tenantId, (tx) => tx.waitlistEntry.create({
      data: { tenantId, guestName: input.guestName, guestPhone: input.guestPhone, guestEmail: input.guestEmail, partySize: input.partySize, desiredAt: input.desiredAt, notes: input.notes },
    }));
    return this.publish(tenantId, row);
  }

  /** Prévient le client qu'une place s'est libérée (email et/ou SMS). */
  async notify(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    const t = await this.settings.tenant(tenantId);
    const row = await this.change(tenantId, id, async (tx, w) => {
      if (!OPEN.includes(w.status)) throw new ConflictException("Cette entrée n'est plus en attente");
      if (!w.guestEmail && !w.guestPhone) throw new ConflictException("Aucun téléphone ni email pour prévenir ce client");
      return tx.waitlistEntry.update({ where: { id }, data: { status: "NOTIFIED", notifiedAt: new Date() } });
    });
    const data = { guestName: row.guestName, partySize: row.partySize, when: this.reservations.formatWhen(row.desiredAt, t.timezone) };
    const sent = [];
    if (row.guestEmail) sent.push(await this.notifications.send({ channel: "EMAIL", to: row.guestEmail, template: "waitlist.available", data, tenantId }));
    if (row.guestPhone) sent.push(await this.notifications.send({ channel: "SMS", to: row.guestPhone, template: "waitlist.available", data, tenantId }));
    return { ...waitlistView(row), notifications: sent.map((s) => s.status) };
  }

  /** Transforme l'entrée en réservation (même transaction : l'entrée ne peut être convertie qu'une fois). */
  async convert(acc: Account, id: string, input: ConvertWaitlistInput) {
    const tenantId = acc.tenantId!;
    const entry = await this.prisma.asTenant(tenantId, (tx) => tx.waitlistEntry.findFirst({ where: { id, tenantId } }));
    if (!entry) throw new NotFoundException("Entrée introuvable");
    if (!OPEN.includes(entry.status)) throw new ConflictException("Cette entrée n'est plus en attente");
    const reservation = await this.reservations.create(acc, {
      guestName: entry.guestName, guestPhone: entry.guestPhone ?? undefined, guestEmail: entry.guestEmail ?? undefined,
      partySize: entry.partySize, startsAt: input.startsAt ?? entry.desiredAt, durationMinutes: input.durationMinutes,
      source: "PHONE", tableIds: input.tableIds, notes: entry.notes ?? undefined, force: input.force, overrideReason: input.overrideReason,
    }, {
      afterCreate: async (tx, reservationId) => {
        await tx.$queryRaw`SELECT id FROM "WaitlistEntry" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
        const done = await tx.waitlistEntry.updateMany({ where: { id, tenantId, status: { in: OPEN } }, data: { status: "CONVERTED", reservationId } });
        if (done.count !== 1) throw new ConflictException("Cette entrée a déjà été traitée");
      },
    });
    const row = await this.prisma.asTenant(tenantId, (tx) => tx.waitlistEntry.findFirstOrThrow({ where: { id, tenantId } }));
    return { entry: this.publish(tenantId, row), reservation };
  }

  async remove(acc: Account, id: string) {
    const tenantId = acc.tenantId!;
    const row = await this.change(tenantId, id, async (tx, w) => {
      if (!OPEN.includes(w.status)) throw new ConflictException("Cette entrée n'est plus en attente");
      return tx.waitlistEntry.update({ where: { id }, data: { status: "REMOVED" } });
    });
    return this.publish(tenantId, row);
  }

  /** Entrées dont l'heure souhaitée est passée depuis plus de 3 heures (tâche planifiée). */
  async expire(now = new Date()) {
    const r = await this.prisma.asPlatform((tx) => tx.waitlistEntry.updateMany({
      where: { status: { in: OPEN }, desiredAt: { lt: new Date(now.getTime() - 3 * 3_600_000) } }, data: { status: "EXPIRED" },
    }));
    return r.count;
  }

  // ── interne ──

  private async change(tenantId: string, id: string, fn: (tx: Tx, w: WaitlistRow) => Promise<WaitlistRow>) {
    const row = await this.prisma.asTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WaitlistEntry" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      const w = await tx.waitlistEntry.findFirst({ where: { id, tenantId } });
      if (!w) throw new NotFoundException("Entrée introuvable");
      return fn(tx, w);
    });
    return row;
  }

  private publish(tenantId: string, row: WaitlistRow) {
    const view = waitlistView(row);
    this.realtime.emit(tenantId, "waitlist.updated", view);
    return view;
  }
}
