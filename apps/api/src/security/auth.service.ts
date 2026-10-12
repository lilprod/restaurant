import { HttpException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import type { RequestMeta } from "../common/request-meta";
import { APP_ENV, Env } from "../config/env";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { Account, AccountsRepo, Space } from "./accounts.repo";
import { LicenseGateService } from "./license-gate.service";
import { LoginEventsService } from "./login-events.service";
import { isLocked, minutesLeft, registerFailure } from "./lockout";
import { PasswordService } from "./password.service";
import { isPasswordExpired, restrictionFor } from "./restrictions";
import { SecurityPolicyService } from "./security-policy.service";
import { SessionService } from "./session.service";
import { TotpService } from "./totp.service";

const INVALID = "Identifiants incorrects";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const accountSummary = (a: Account) => ({
  id: a.id, email: a.email, firstName: a.firstName, lastName: a.lastName, phone: a.phone, role: a.role,
  locale: a.locale, tenantId: a.tenantId, twoFactorEnabled: a.twoFactorEnabled, avatarUrl: a.avatarUrl,
});

/** Authentification commune à la plateforme et aux restaurants. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountsRepo,
    private readonly policies: SecurityPolicyService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly events: LoginEventsService,
    private readonly gate: LicenseGateService,
    private readonly mail: MailService,
    private readonly jwt: JwtService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async login(space: Space, dto: { email: string; password: string; tenantSlug?: string }, meta: RequestMeta) {
    const now = new Date();
    const email = dto.email.trim().toLowerCase();
    let tenantId: string | null = null;

    if (space === "tenant") {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug: (dto.tenantSlug ?? "").toLowerCase() } });
      if (!tenant) {
        await this.passwords.verify(null, dto.password);
        await this.events.record({ space, email, result: "UNKNOWN_ACCOUNT", meta });
        throw new UnauthorizedException(INVALID);
      }
      tenantId = tenant.id;
    }

    const acc = await this.repo.findByEmail(space, email, tenantId);
    if (!acc) {
      await this.passwords.verify(null, dto.password);
      await this.events.record({ space, tenantId, email, result: "UNKNOWN_ACCOUNT", meta });
      throw new UnauthorizedException(INVALID);
    }
    const policy = await this.policies.get(space, tenantId);

    if (isLocked(acc.lockedUntil, now)) {
      await this.events.record({ space, tenantId, accountId: acc.id, email, result: "LOCKED", meta });
      throw this.lockedError(acc.lockedUntil!, now);
    }
    if (!(await this.passwords.verify(acc.passwordHash, dto.password))) {
      await this.fail(acc, policy, now, "BAD_PASSWORD", meta);
      throw new UnauthorizedException(INVALID);
    }
    if (!acc.isActive) {
      await this.events.record({ space, tenantId, accountId: acc.id, email, result: "ACCOUNT_DISABLED", meta });
      throw new UnauthorizedException("Ce compte est désactivé");
    }
    if (tenantId) {
      try { await this.gate.assertAccess(tenantId); } catch (e) {
        await this.events.record({ space, tenantId, accountId: acc.id, email, result: "LICENSE_BLOCKED", meta });
        throw e;
      }
    }

    if (acc.twoFactorEnabled) {
      await this.events.record({ space, tenantId, accountId: acc.id, email, result: "TWO_FACTOR_REQUIRED", meta });
      return { twoFactorRequired: true as const, challengeToken: await this.sessions.signChallenge(acc) };
    }
    return this.complete(acc, now, meta);
  }

  /** Seconde étape : code de l'application d'authentification, ou code de secours. */
  async verifyTwoFactor(challengeToken: string, code: string, meta: RequestMeta) {
    let claims: { sub: string; typ: string; space: Space; tid?: string };
    try { claims = await this.jwt.verifyAsync(challengeToken); } catch { throw new UnauthorizedException("Session de vérification expirée"); }
    if (claims.typ !== "2fa") throw new UnauthorizedException("Session de vérification invalide");

    const now = new Date();
    const acc = await this.repo.findById(claims.space, claims.sub, claims.tid);
    if (!acc || !acc.isActive || !acc.twoFactorEnabled || !acc.twoFactorSecret) throw new UnauthorizedException("Session de vérification invalide");
    if (isLocked(acc.lockedUntil, now)) {
      await this.events.record({ space: acc.space, tenantId: acc.tenantId, accountId: acc.id, email: acc.email, result: "LOCKED", meta });
      throw this.lockedError(acc.lockedUntil!, now);
    }
    const policy = await this.policies.get(acc.space, acc.tenantId);

    let ok = this.totp.verify(acc.twoFactorSecret, code.replace(/\s/g, ""));
    let remaining: string[] | null = null;
    if (!ok && this.totp.looksLikeRecoveryCode(code)) {
      remaining = this.totp.consumeRecoveryCode(acc.recoveryCodeHashes, code);
      ok = remaining !== null;
    }
    if (!ok) {
      await this.fail(acc, policy, now, "TWO_FACTOR_FAILED", meta);
      throw new UnauthorizedException("Code de vérification incorrect");
    }
    if (remaining) await this.repo.update(acc.space, acc.id, acc.tenantId, { recoveryCodeHashes: remaining });
    if (acc.tenantId) await this.gate.assertAccess(acc.tenantId);
    return this.complete(acc, now, meta);
  }

  async refresh(space: Space, refreshToken: string, meta: RequestMeta) {
    const rotated = await this.sessions.rotate(refreshToken, meta);
    const fail = () => new UnauthorizedException("Session expirée");
    if (!rotated) throw fail();
    const { row, refreshToken: next } = rotated;
    const isPlatform = !!row.platformUserId;
    if ((space === "platform") !== isPlatform) throw fail();

    const acc = await this.repo.findById(space, (row.platformUserId ?? row.userId)!, row.tenantId);
    if (!acc || !acc.isActive) throw fail();
    if (acc.tenantId) await this.gate.assertAccess(acc.tenantId);
    return { accessToken: await this.sessions.signAccess(acc, row.id), refreshToken: next, expiresIn: 900 };
  }

  logout(refreshToken: string) {
    return this.sessions.revokeByToken(refreshToken);
  }

  // ── Mot de passe oublié / réinitialisation ──

  /** Répond toujours de la même façon (pas d'énumération de comptes). Le lien est envoyé par email. */
  async forgotPassword(space: Space, dto: { email: string; tenantSlug?: string }) {
    const email = dto.email.trim().toLowerCase();
    let tenantId: string | null = null;
    if (space === "tenant") {
      const t = await this.prisma.tenant.findUnique({ where: { slug: (dto.tenantSlug ?? "").toLowerCase() } });
      if (!t) return;
      tenantId = t.id;
    }
    const acc = await this.repo.findByEmail(space, email, tenantId);
    if (!acc?.isActive) return;

    const owner = space === "platform" ? { platformUserId: acc.id } : { userId: acc.id, tenantId };
    await this.prisma.passwordReset.updateMany({ where: { ...owner, usedAt: null }, data: { usedAt: new Date() } });
    const token = randomBytes(32).toString("base64url");
    await this.prisma.passwordReset.create({ data: { ...owner, tokenHash: sha(token), expiresAt: new Date(Date.now() + 3_600_000) } });

    const params = new URLSearchParams({ token, space, ...(dto.tenantSlug ? { tenant: dto.tenantSlug } : {}) });
    await this.mail.send({
      to: acc.email,
      subject: "Réinitialisation de votre mot de passe",
      text: `Bonjour ${acc.firstName},\n\nPour choisir un nouveau mot de passe (lien valable 1 heure) :\n${this.env.APP_URL}/reset-password?${params}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
    });
  }

  async resetPassword(space: Space, token: string, newPassword: string, meta: RequestMeta) {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha(token) } });
    const bad = () => new UnauthorizedException("Lien invalide ou expiré");
    if (!row || row.usedAt || row.expiresAt < new Date()) throw bad();
    if ((space === "platform") !== !!row.platformUserId) throw bad();

    const acc = await this.repo.findById(space, (row.platformUserId ?? row.userId)!, row.tenantId);
    if (!acc?.isActive) throw bad();
    const policy = await this.policies.get(space, acc.tenantId);
    this.passwords.assertValid(newPassword, policy, acc);

    const claimed = await this.prisma.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) throw bad();
    await this.repo.update(space, acc.id, acc.tenantId, {
      passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: new Date(),
      mustChangePassword: false, failedLoginCount: 0, lockedUntil: null,
    });
    await this.sessions.revokeAll(acc);
    await this.events.record({ space, tenantId: acc.tenantId, accountId: acc.id, email: acc.email, result: "SUCCESS", meta });
  }

  // ── interne ──

  private async fail(acc: Account, policy: Awaited<ReturnType<SecurityPolicyService["get"]>>, now: Date, result: "BAD_PASSWORD" | "TWO_FACTOR_FAILED", meta: RequestMeta) {
    const next = registerFailure(acc, policy, now);
    await this.repo.update(acc.space, acc.id, acc.tenantId, next);
    await this.events.record({ space: acc.space, tenantId: acc.tenantId, accountId: acc.id, email: acc.email, result: next.lockedUntil ? "LOCKED" : result, meta });
  }

  private lockedError(until: Date, now: Date) {
    return new HttpException(
      { statusCode: 423, code: "ACCOUNT_LOCKED", message: `Trop de tentatives. Réessayez dans ${minutesLeft(until, now)} minute(s).` }, 423,
    );
  }

  /** Ouvre la session une fois toutes les vérifications passées. */
  private async complete(acc: Account, now: Date, meta: RequestMeta) {
    const policy = await this.policies.get(acc.space, acc.tenantId);
    const expired = isPasswordExpired(acc.passwordChangedAt, policy.passwordExpiryDays, now);
    const mustChange = acc.mustChangePassword || expired;
    await this.repo.update(acc.space, acc.id, acc.tenantId, {
      failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, lastLoginIp: meta.ip,
      ...(mustChange && !acc.mustChangePassword ? { mustChangePassword: true } : {}),
    });
    const current = { ...acc, mustChangePassword: mustChange };
    const session = await this.sessions.open(current, meta, policy.sessionDays);
    await this.events.record({ space: acc.space, tenantId: acc.tenantId, accountId: acc.id, email: acc.email, result: "SUCCESS", meta });

    const license = acc.tenantId ? await this.gate.assertAccess(acc.tenantId) : undefined;
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: accountSummary(current),
      restriction: restrictionFor(current, policy),   // "pwd-change" | "2fa-setup" | null
      license: license && { status: license.status, inGrace: license.inGrace, currentPeriodEnd: license.currentPeriodEnd },
    };
  }
}
