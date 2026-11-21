import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PushSubscriptionInput } from "@restaurant/validation";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { NotificationsService } from "./notifications.service";

/** Appareils au plus par compte (les plus anciens sont retirés) : un abonnement n'est pas une ressource illimitée. */
export const MAX_DEVICES_PER_ACCOUNT = 10;

/** « Chrome · Android » : assez pour reconnaître son appareil, sans empreinte détaillée. */
export function shortUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return [browser, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

/** Abonnements Web Push des appareils du personnel (X5B). Un appareil = un compte à la fois. */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  config() {
    const enabled = this.notifications.pushEnabled;
    return { enabled, publicKey: enabled ? this.env.VAPID_PUBLIC_KEY! : null };
  }

  /**
   * Création ou mise à jour idempotente par endpoint. Un endpoint déjà connu (autre compte, autre restaurant : même appareil)
   * est réattribué au compte courant. Opération de plateforme : l'endpoint est unique toutes entreprises confondues, la RLS d'un
   * seul restaurant ne verrait pas l'ancienne ligne ; le restaurant et le compte viennent du jeton, jamais du client.
   */
  async subscribe(acc: Account, sessionId: string, input: PushSubscriptionInput, userAgent: string | null) {
    if (!this.notifications.pushEnabled) throw new ConflictException("Les notifications push ne sont pas activées sur ce serveur");
    const tenantId = acc.tenantId!;
    const ua = shortUserAgent(userAgent);
    const data = { tenantId, userId: acc.id, sessionId, p256dh: input.keys.p256dh, auth: input.keys.auth, ...(ua ? { userAgent: ua } : {}), lastSeenAt: new Date() };
    return this.prisma.asPlatform(async (tx) => {
      const before = await tx.pushSubscription.findUnique({ where: { endpoint: input.endpoint }, select: { userId: true } });
      const row = await tx.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { ...data, endpoint: input.endpoint }, update: data, select: { id: true } });
      const mine = await tx.pushSubscription.findMany({ where: { tenantId, userId: acc.id }, orderBy: { lastSeenAt: "desc" }, select: { id: true } });
      const extra = mine.slice(MAX_DEVICES_PER_ACCOUNT).map((s) => s.id);
      if (extra.length) await tx.pushSubscription.deleteMany({ where: { id: { in: extra } } });
      return { id: row.id, created: !before, reassigned: !!before && before.userId !== acc.id };
    });
  }

  /** Supprime l'abonnement de ce compte (jamais celui d'un autre : même réponse si rien à supprimer). */
  async unsubscribe(acc: Account, endpoint: string) {
    await this.prisma.asTenant(acc.tenantId!, (tx) => tx.pushSubscription.deleteMany({ where: { endpoint, userId: acc.id, tenantId: acc.tenantId! } }));
  }

  /** Notification de test à soi-même (cet appareil, ou tous les appareils du compte). */
  async test(acc: Account, endpoint?: string) {
    if (!this.notifications.pushEnabled) throw new ConflictException("Les notifications push ne sont pas activées sur ce serveur");
    const r = await this.notifications.sendPush(
      { template: "push.test", data: {}, tenantId: acc.tenantId!, audience: { userIds: [acc.id], endpoint } },
      { ignorePreferences: true },
    );
    if (r.skipped === "no_device") throw new ConflictException("Aucun appareil enregistré pour votre compte : activez d'abord les notifications sur cet appareil");
    return { sent: r.queued };
  }
}
