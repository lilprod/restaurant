import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { reminderInstant } from "@restaurant/utils";
import type { ReservationsSettingsInput } from "@restaurant/validation";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { ReservationsService } from "./reservations.service";
import { reservationInclude, reservationView } from "./reservations.views";
import { WaitlistService } from "./waitlist.service";

const MIN = 60_000;

/**
 * Tâches planifiées des réservations (toutes les 5 minutes) :
 *  - rappel au client la veille à 18 h (heure du restaurant), une seule fois : `reminderSentAt` + clé de déduplication du journal X1 ;
 *  - proposition « absent » (no-show) après `noShowGraceMinutes` de retard : `noShowSuggested` passe à vrai (`reservation.updated`) ;
 *  - expiration des entrées de liste d'attente dont l'heure souhaitée est passée depuis 3 h.
 */
@Injectable()
export class ReservationsTasks {
  private readonly log = new Logger(ReservationsTasks.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    private readonly reservations: ReservationsService,
    private readonly waitlist: WaitlistService,
    private readonly realtime: RealtimeService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledRun() {
    if (this.env.DISABLE_CRON) return;
    try {
      const r = await this.run();
      if (r.reminders || r.noShows) this.log.log(`Réservations : ${r.reminders} rappel(s), ${r.noShows} absence(s) proposée(s)`);
    } catch (e) {
      this.log.error(`Tâches des réservations : ${(e as Error).message}`);
    }
  }

  async run(now = new Date()) {
    return {
      reminders: await this.sendReminders(now),
      noShows: await this.suggestNoShows(now),
      expiredWaitlist: await this.waitlist.expire(now),
    };
  }

  /** Rappels de la veille. Une réservation prise après l'heure du rappel n'en reçoit pas (la confirmation vient de partir). */
  async sendReminders(now = new Date()): Promise<number> {
    const due = await this.prisma.asPlatform((tx) => tx.reservation.findMany({
      where: { status: "CONFIRMED", reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 48 * 3_600_000) } },
      include: { tenant: { select: { id: true, timezone: true, status: true } } },
    }));
    let sent = 0;
    for (const r of due) {
      if (r.tenant.status !== "ACTIVE" && r.tenant.status !== "TRIAL") continue;
      const at = reminderInstant(r.startsAt, r.tenant.timezone, 18);
      if (!at || now < at) continue;
      if (r.createdAt >= at) {
        await this.prisma.asTenant(r.tenantId, (tx) => tx.reservation.update({ where: { id: r.id }, data: { reminderSentAt: now } }));
        continue;
      }
      const results = await this.reservations.notify(r.tenant, r, "reservation.reminder", {}, `reservation:${r.id}:reminder:${r.startsAt.toISOString()}`);
      // marqué même sans coordonnées ou canal désactivé : on ne réessaie pas toutes les 5 minutes
      await this.prisma.asTenant(r.tenantId, (tx) => tx.reservation.update({ where: { id: r.id }, data: { reminderSentAt: now } }));
      sent += results.filter((x) => x.status === "queued").length;
    }
    return sent;
  }

  /** Propose « absent » pour les réservations non installées après le délai de grâce du restaurant. */
  async suggestNoShows(now = new Date()): Promise<number> {
    const late = await this.prisma.asPlatform((tx) => tx.reservation.findMany({
      where: { status: { in: ["PENDING", "CONFIRMED"] }, noShowSuggestedAt: null, startsAt: { lt: now, gt: new Date(now.getTime() - 24 * 3_600_000) } },
      select: { id: true, tenantId: true, startsAt: true },
    }));
    const graceOf = new Map<string, number>();
    let n = 0;
    for (const r of late) {
      if (!graceOf.has(r.tenantId)) {
        const rs: ReservationsSettingsInput = await this.settings.getSection("reservations", await this.settings.tenant(r.tenantId));
        graceOf.set(r.tenantId, rs.noShowGraceMinutes);
      }
      if (now.getTime() < r.startsAt.getTime() + graceOf.get(r.tenantId)! * MIN) continue;
      const row = await this.prisma.asTenant(r.tenantId, async (tx) => {
        const done = await tx.reservation.updateMany({ where: { id: r.id, noShowSuggestedAt: null, status: { in: ["PENDING", "CONFIRMED"] } }, data: { noShowSuggestedAt: now } });
        return done.count ? tx.reservation.findUniqueOrThrow({ where: { id: r.id }, include: reservationInclude }) : null;
      });
      if (row) { this.realtime.emit(r.tenantId, "reservation.updated", reservationView(row)); n++; }
    }
    return n;
  }
}
