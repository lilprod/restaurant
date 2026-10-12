import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import type { RequestMeta } from "../common/request-meta";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { Account, Space } from "./accounts.repo";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

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
    return { sessionId: row.id, refreshToken, accessToken: await this.signAccess(acc, row.id), expiresIn: 900 };
  }

  signAccess(acc: Account, sid: string) {
    const claims: AccessClaims = { sub: acc.id, typ: acc.space, tid: acc.tenantId ?? undefined, role: acc.role, sid };
    return this.jwt.signAsync(claims, { expiresIn: "15m" });
  }

  signChallenge(acc: Account) {
    return this.jwt.signAsync({ sub: acc.id, typ: "2fa", space: acc.space, tid: acc.tenantId ?? undefined }, { expiresIn: "5m" });
  }

  /** Rotation en place : l'ancien jeton cesse de fonctionner, l'identifiant de session reste le même. */
  async rotate(oldToken: string, meta: RequestMeta) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(oldToken) } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) return null;
    const refreshToken = randomBytes(48).toString("base64url");
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, tokenHash: row.tokenHash, revokedAt: null },
      data: { tokenHash: hashToken(refreshToken), lastUsedAt: new Date(), ip: meta.ip, userAgent: meta.userAgent },
    });
    return claimed.count === 1 ? { row, refreshToken } : null;
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

  async revoke(acc: Pick<Account, "space" | "id">, sessionId: string) {
    const r = await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, ...this.owner(acc), revokedAt: null }, data: { revokedAt: new Date() },
    });
    return r.count === 1;
  }

  /** Révoque toutes les sessions, sauf éventuellement la session courante. */
  async revokeAll(acc: Pick<Account, "space" | "id">, exceptSessionId?: string) {
    const r = await this.prisma.refreshToken.updateMany({
      where: { ...this.owner(acc), revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }

  async revokeByToken(token: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
