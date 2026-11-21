import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

const DAY = 86_400_000;

/**
 * Durées de conservation (RGPD, minimisation). Registre complet : docs/API.md, section « Conservation des données ».
 * Les journaux métier (AuditLog, PlatformAuditLog) et la comptabilité (commandes, paiements) ne sont pas purgés ici :
 * ils relèvent d'obligations légales de conservation.
 */
export const RETENTION_DAYS = {
  /** Journal de connexion (IP, navigateur, email tenté) : 12 mois. */
  loginEvents: 365,
  /** Journal des notifications (destinataire, variables du modèle) : 6 mois. */
  notificationLogs: 180,
  /** Sessions fermées ou échues : 30 jours après leur fin (historique « appareils »). */
  closedSessions: 30,
  /** Liens de réinitialisation et codes de vérification d'email utilisés ou expirés : 7 jours. */
  oneTimeCodes: 7,
  /** Abonnements push inactifs (l'application n'a pas rouvert l'appareil) : 60 jours. */
  pushSubscriptions: 60,
} as const;

@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService, @Inject(APP_ENV) private readonly env: Env) {}

  /** Chaque nuit à 3 h 17 (UTC). */
  @Cron("17 3 * * *")
  async scheduledPurge() {
    if (this.env.DISABLE_CRON) return;
    try {
      const r = await this.purge();
      const total = Object.values(r).reduce((a, b) => a + b, 0);
      if (total) this.log.log(`Purge de conservation : ${JSON.stringify(r)}`);
    } catch (e) {
      this.log.error(`Purge de conservation : ${(e as Error).message}`);
    }
  }

  /** Supprime ce qui dépasse sa durée de conservation. Idempotent. */
  async purge(now = new Date()) {
    const before = (days: number) => new Date(now.getTime() - days * DAY);
    return this.prisma.asPlatform(async (tx) => {
      const loginEvents = await tx.loginEvent.deleteMany({ where: { createdAt: { lt: before(RETENTION_DAYS.loginEvents) } } });
      const notificationLogs = await tx.notificationLog.deleteMany({ where: { createdAt: { lt: before(RETENTION_DAYS.notificationLogs) } } });
      const closed = before(RETENTION_DAYS.closedSessions);
      const sessions = await tx.refreshToken.deleteMany({ where: { OR: [{ revokedAt: { lt: closed } }, { expiresAt: { lt: closed } }] } });
      const codes = before(RETENTION_DAYS.oneTimeCodes);
      const passwordResets = await tx.passwordReset.deleteMany({ where: { OR: [{ usedAt: { lt: codes } }, { expiresAt: { lt: codes } }] } });
      const emailVerifications = await tx.emailVerification.deleteMany({ where: { expiresAt: { lt: codes } } });
      // X5 : clés d'idempotence échues (réponses rejouables 24 h).
      const idempotencyKeys = await tx.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
      // X5B : abonnements push inactifs, ou dont la session est terminée / purgée (appareil qui n'a jamais prévenu à la déconnexion).
      const pushInactive = await tx.pushSubscription.deleteMany({ where: { lastSeenAt: { lt: before(RETENTION_DAYS.pushSubscriptions) } } });
      const pushOrphans = await tx.$executeRaw`
        DELETE FROM "PushSubscription" p WHERE p."sessionId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "RefreshToken" r WHERE r.id = p."sessionId" AND r."revokedAt" IS NULL AND r."expiresAt" > ${now})`;
      return {
        pushSubscriptions: pushInactive.count + pushOrphans, idempotencyKeys: idempotencyKeys.count, loginEvents: loginEvents.count, notificationLogs: notificationLogs.count, sessions: sessions.count,
        passwordResets: passwordResets.count, emailVerifications: emailVerifications.count,
      };
    });
  }
}
