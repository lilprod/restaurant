import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import type { RequestMeta } from "../common/request-meta";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { Account, Space } from "./accounts.repo";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Délai pendant lequel le jeton de rafraîchissement remplacé reste accepté (réponse de rotation perdue). */
export const ROTATION_GRACE_MS = 20_000;

export interface AccessClaims {
  sub: string;
  typ: Space;
  tid?: string;
  role: string;
  sid: string;
}

/** Sessions = jetons de rafraîchissement (un par appareil). Le sid du jeton d'accès permet une révocation immédiate. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async open(acc: Account, meta: RequestMeta, sessionDays: number) {
    const refreshToken = randomBytes(48).toString("base64url");
    const row = await this.prisma.refreshToken.create({
      data: {
        ...(acc.space === "platform" ? { platformUserId: acc.id } : { userId: acc.id, tenantId: acc.tenantId }),
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent,
        ip: meta.ip,
        expiresAt: new Date(Date.now() + sessionDays * 86_400_000),
      },
    });
    return { sessionId: row.id, refreshToken, refreshExpiresAt: row.expiresAt, accessToken: await this.signAccess(acc, row.id), expiresIn: 900 };
  }

  signAccess(acc: Account, sid: string) {
    const claims: AccessClaims = { sub: acc.id, typ: acc.space, tid: acc.tenantId ?? undefined, role: acc.role, sid };
    return this.jwt.signAsync(claims, { expiresIn: "15m" });
  }

  signChallenge(acc: Account) {
    return this.jwt.signAsync({ sub: acc.id, typ: "2fa", space: acc.space, tid: acc.tenantId ?? undefined }, { expiresIn: "5m" });
  }

  /**
   * Rotation en place (l'identifiant de session reste le même), avec délai de grâce :
   * - jeton courant → nouveau jeton ; l'ancien devient « précédent » ;
   * - jeton précédent présenté dans les ROTATION_GRACE_MS qui suivent la rotation (réponse perdue : rechargement, navigation,
   *   coupure réseau, deux requêtes simultanées) → nouveau jeton, la session continue ;
   * - jeton précédent présenté APRÈS ce délai → réutilisation d'un jeton déjà remplacé : vol présumé, toute la session est révoquée.
   */
  async rotate(oldToken: string, meta: RequestMeta) {
    const h = hashToken(oldToken);
    const now = new Date();
    const usable = (r: { revokedAt: Date | null; expiresAt: Date }) => !r.revokedAt && r.expiresAt >= now;
    const current = await this.prisma.refreshToken.findUnique({ where: { tokenHash: h } });
    if (current) {
      if (!usable(current)) return null;
      const refreshToken = randomBytes(48).toString("base64url");
      const claimed = await this.prisma.refreshToken.updateMany({
        where: { id: current.id, tokenHash: h, revokedAt: null },
        data: { tokenHash: hashToken(refreshToken), previousTokenHash: h, rotatedAt: now, lastUsedAt: now, ip: meta.ip, userAgent: meta.userAgent },
      });
      if (claimed.count === 1) return { row: current, refreshToken };
      // Une requête simultanée vient de faire tourner ce jeton : il est maintenant « précédent », on passe par la grâce ci-dessous.
    }
    const prev = await this.prisma.refreshToken.findUnique({ where: { previousTokenHash: h } });
    if (!prev || !usable(prev) || !prev.rotatedAt) return null;
    if (now.getTime() - prev.rotatedAt.getTime() > ROTATION_GRACE_MS) {
      await this.prisma.refreshToken.updateMany({ where: { id: prev.id, revokedAt: null }, data: { revokedAt: now } });
      if (prev.userId) await this.dropPush({ sessionId: prev.id, userId: prev.userId });
      return null;
    }
    const refreshToken = randomBytes(48).toString("base64url");
    // Le délai de grâce court toujours depuis la PREMIÈRE rotation (rotatedAt inchangé) : il ne peut pas être prolongé indéfiniment.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: prev.id, tokenHash: prev.tokenHash, revokedAt: null },
      data: { tokenHash: hashToken(refreshToken), lastUsedAt: now, ip: meta.ip, userAgent: meta.userAgent },
    });
    return claimed.count === 1 ? { row: prev, refreshToken } : null;
  }

  async isActive(sid: string, accountId: string): Promise<boolean> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id: sid } });
    return !!row && !row.revokedAt && row.expiresAt > new Date() && (row.userId === accountId || row.platformUserId === accountId);
  }

  private owner(acc: Pick<Account, "space" | "id">) {
    return acc.space === "platform" ? { platformUserId: acc.id } : { userId: acc.id };
  }

  list(acc: Pick<Account, "space" | "id">) {
    return this.prisma.refreshToken.findMany({
      where: { ...this.owner(acc), revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  }

  /** X5B : une session qui se termine (déconnexion, révocation, compte désactivé) emporte les abonnements push de son appareil. */
  private dropPush(where: Prisma.PushSubscriptionWhereInput) {
    return this.prisma.asPlatform((tx) => tx.pushSubscription.deleteMany({ where }));
  }

  async revoke(acc: Pick<Account, "space" | "id">, sessionId: string) {
    const r = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, ...this.owner(acc), revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (acc.space === "tenant") await this.dropPush({ sessionId, userId: acc.id });
    return r.count === 1;
  }

  /** Révoque toutes les sessions, sauf éventuellement la session courante. */
  async revokeAll(acc: Pick<Account, "space" | "id">, exceptSessionId?: string) {
    const r = await this.prisma.refreshToken.updateMany({
      where: { ...this.owner(acc), revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    if (acc.space === "tenant") await this.dropPush({ userId: acc.id, ...(exceptSessionId ? { OR: [{ sessionId: null }, { sessionId: { not: exceptSessionId } }] } : {}) });
    return r.count;
  }

  async revokeByToken(token: string) {
    // Jeton courant ou précédent (déconnexion après une réponse de rotation perdue) : la session est fermée dans les deux cas.
    const where = { OR: [{ tokenHash: hashToken(token) }, { previousTokenHash: hashToken(token) }] };
    const row = await this.prisma.refreshToken.findFirst({ where, select: { id: true, userId: true } });
    await this.prisma.refreshToken.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date() } });
    if (row?.userId) await this.dropPush({ sessionId: row.id, userId: row.userId });
  }
}
