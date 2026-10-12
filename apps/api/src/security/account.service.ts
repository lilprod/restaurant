import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { RequestMeta } from "../common/request-meta";
import { StorageService } from "../storage/storage.service";
import { ASSET_RULES, validateImage } from "../storage/image-validation";
import { Account, AccountsRepo } from "./accounts.repo";
import { accountSummary } from "./auth.service";
import { LoginEventsService } from "./login-events.service";
import { PasswordService } from "./password.service";
import { restrictionFor } from "./restrictions";
import { SecurityPolicyService } from "./security-policy.service";
import { SessionService } from "./session.service";
import { TotpService } from "./totp.service";

const PROFILE_FIELDS = ["firstName", "lastName", "phone", "locale"] as const;

/** Espace « Mon compte » : profil, mot de passe, sessions, double authentification, historique. */
@Injectable()
export class AccountService {
  constructor(
    private readonly repo: AccountsRepo,
    private readonly passwords: PasswordService,
    private readonly policies: SecurityPolicyService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly events: LoginEventsService,
    private readonly storage: StorageService,
  ) {}

  async profile(acc: Account) {
    const policy = await this.policies.get(acc.space, acc.tenantId);
    return {
      ...accountSummary(acc),
      lastLoginAt: acc.lastLoginAt,
      passwordChangedAt: acc.passwordChangedAt,
      recoveryCodesLeft: acc.recoveryCodeHashes.length,
      twoFactorRequired: policy.requires2fa(acc.role),
      mustChangePassword: acc.mustChangePassword,
      // Permet à l'interface de reprendre une session restreinte après un rechargement,
      // et d'afficher les règles de mot de passe à tous les rôles (elles ne sont pas secrètes).
      restriction: restrictionFor(acc, policy),
      passwordPolicy: policy.passwordPolicy,
    };
  }

  async updateProfile(acc: Account, patch: Partial<Record<(typeof PROFILE_FIELDS)[number], string | undefined>>) {
    const data = Object.fromEntries(PROFILE_FIELDS.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]));
    await this.repo.update(acc.space, acc.id, acc.tenantId, data);
    return this.profile((await this.repo.findById(acc.space, acc.id, acc.tenantId))!);
  }

  async uploadAvatar(acc: Account, file: { buffer: Buffer } | undefined) {
    const type = validateImage(file?.buffer, ASSET_RULES.avatar);
    const scope = acc.space === "platform" ? "platform/avatars" : `tenants/${acc.tenantId}/avatars`;
    const url = await this.storage.save(scope, acc.id.slice(0, 8), file!.buffer, type);
    await this.storage.remove(acc.avatarUrl);
    await this.repo.update(acc.space, acc.id, acc.tenantId, { avatarUrl: url });
    return { avatarUrl: url };
  }

  async changePassword(acc: Account, sessionId: string, current: string, next: string) {
    if (!(await this.passwords.verify(acc.passwordHash, current))) throw new UnauthorizedException("Mot de passe actuel incorrect");
    if (current === next) throw new BadRequestException("Le nouveau mot de passe doit être différent de l'ancien");
    const policy = await this.policies.get(acc.space, acc.tenantId);
    this.passwords.assertValid(next, policy, acc);

    const wasRestricted = acc.mustChangePassword;
    await this.repo.update(acc.space, acc.id, acc.tenantId, {
      passwordHash: await this.passwords.hash(next), passwordChangedAt: new Date(), mustChangePassword: false,
    });
    // Toutes les autres sessions sont fermées. Une session restreinte l'est aussi : on se reconnecte proprement.
    await this.sessions.revokeAll(acc, wasRestricted ? undefined : sessionId);
    return { ok: true, reloginRequired: wasRestricted };
  }

  sessionsList(acc: Account, currentSessionId: string) {
    return this.sessions.list(acc).then((rows) => rows.map((r) => ({ ...r, current: r.id === currentSessionId })));
  }

  async revokeSession(acc: Account, sessionId: string) {
    if (!(await this.sessions.revoke(acc, sessionId))) throw new NotFoundException("Session introuvable");
  }

  revokeOtherSessions(acc: Account, currentSessionId: string) {
    return this.sessions.revokeAll(acc, currentSessionId).then((revoked) => ({ revoked }));
  }

  // ── Double authentification ──

  /** Étape 1 : génère le secret (non actif tant que le premier code n'a pas été confirmé). */
  async twoFactorSetup(acc: Account) {
    if (acc.twoFactorEnabled) throw new ConflictException("La double authentification est déjà activée");
    const g = await this.totp.generate(acc.email, "Restaurant");
    await this.repo.update(acc.space, acc.id, acc.tenantId, { twoFactorSecret: g.encryptedSecret });
    return { secret: g.secret, otpauthUrl: g.otpauthUrl, qrDataUrl: g.qrDataUrl };
  }

  /** Étape 2 : confirme avec un premier code et remet les codes de secours (affichés une seule fois). */
  async twoFactorEnable(acc: Account, code: string) {
    if (acc.twoFactorEnabled) throw new ConflictException("La double authentification est déjà activée");
    if (!acc.twoFactorSecret) throw new BadRequestException("Lancez d'abord la configuration");
    if (!this.totp.verify(acc.twoFactorSecret, code)) throw new BadRequestException("Code incorrect");
    const { codes, hashes } = this.totp.generateRecoveryCodes();
    await this.repo.update(acc.space, acc.id, acc.tenantId, { twoFactorEnabled: true, recoveryCodeHashes: hashes });
    return { enabled: true, recoveryCodes: codes };
  }

  async twoFactorDisable(acc: Account, password: string, code?: string) {
    await this.confirmSensitive(acc, password, code);
    const policy = await this.policies.get(acc.space, acc.tenantId);
    if (policy.requires2fa(acc.role)) throw new ConflictException("La double authentification est obligatoire pour votre rôle");
    await this.repo.update(acc.space, acc.id, acc.tenantId, { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodeHashes: [] });
    return { enabled: false };
  }

  async regenerateRecoveryCodes(acc: Account, password: string, code?: string) {
    if (!acc.twoFactorEnabled) throw new BadRequestException("La double authentification n'est pas activée");
    await this.confirmSensitive(acc, password, code);
    const { codes, hashes } = this.totp.generateRecoveryCodes();
    await this.repo.update(acc.space, acc.id, acc.tenantId, { recoveryCodeHashes: hashes });
    return { recoveryCodes: codes };
  }

  /** Actions sensibles : mot de passe + (si la 2FA est active) un code. */
  private async confirmSensitive(acc: Account, password: string, code?: string) {
    if (!(await this.passwords.verify(acc.passwordHash, password))) throw new UnauthorizedException("Mot de passe incorrect");
    if (acc.twoFactorEnabled) {
      if (!code || !acc.twoFactorSecret || !this.totp.verify(acc.twoFactorSecret, code.replace(/\s/g, ""))) {
        throw new UnauthorizedException("Code de vérification requis ou incorrect");
      }
    }
  }

  loginHistory(acc: Account) {
    return this.events.list(acc.space === "platform" ? { platformUserId: acc.id } : { userId: acc.id }, 50);
  }
}
