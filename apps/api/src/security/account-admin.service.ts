import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Account, AccountsRepo, Space } from "./accounts.repo";
import { PasswordService } from "./password.service";
import { SecurityPolicyService } from "./security-policy.service";
import { SessionService } from "./session.service";

export type Actor = { kind: "platform" | "tenant"; id: string };

/** Actions d'administration sur le compte d'un autre utilisateur (réinitialiser, déverrouiller, déconnecter…). */
@Injectable()
export class AccountAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountsRepo,
    private readonly passwords: PasswordService,
    private readonly policies: SecurityPolicyService,
    private readonly sessions: SessionService,
  ) {}

  /** Liste des utilisateurs d'un restaurant avec leur état de sécurité. */
  async listTenantUsers(tenantId: string) {
    const users = await this.prisma.asTenant(tenantId, (tx) => tx.user.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }));
    const now = new Date();
    return users.map((u) => ({
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, isActive: u.isActive,
      twoFactorEnabled: u.twoFactorEnabled, mustChangePassword: u.mustChangePassword,
      locked: !!u.lockedUntil && u.lockedUntil > now, lastLoginAt: u.lastLoginAt,
    }));
  }

  private async target(space: Space, tenantId: string | null, id: string): Promise<Account> {
    const acc = await this.repo.findById(space, id, tenantId);
    if (!acc) throw new NotFoundException("Utilisateur introuvable");
    return acc;
  }

  /** Mot de passe temporaire à transmettre en main propre ; l'utilisateur devra le changer à la première connexion. */
  async resetPassword(space: Space, tenantId: string | null, id: string, actor: Actor) {
    const acc = await this.target(space, tenantId, id);
    const policy = await this.policies.get(space, tenantId);
    const temporaryPassword = this.passwords.generateTemporary(policy);
    await this.repo.update(space, id, tenantId, {
      passwordHash: await this.passwords.hash(temporaryPassword), mustChangePassword: true,
      passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null,
    });
    await this.sessions.revokeAll(acc);
    await this.audit(space, tenantId, actor, "security.reset_password", id);
    return { temporaryPassword, mustChangePassword: true };
  }

  async unlock(space: Space, tenantId: string | null, id: string, actor: Actor) {
    await this.target(space, tenantId, id);
    await this.repo.update(space, id, tenantId, { failedLoginCount: 0, lockedUntil: null });
    await this.audit(space, tenantId, actor, "security.unlock", id);
    return { ok: true };
  }

  /** Perte du téléphone : l'administrateur retire la 2FA, l'utilisateur la reconfigurera. */
  async disableTwoFactor(space: Space, tenantId: string | null, id: string, actor: Actor) {
    await this.target(space, tenantId, id);
    await this.repo.update(space, id, tenantId, { twoFactorEnabled: false, twoFactorSecret: null, recoveryCodeHashes: [] });
    await this.sessions.revokeAll({ space, id });
    await this.audit(space, tenantId, actor, "security.disable_2fa", id);
    return { ok: true };
  }

  async revokeSessions(space: Space, tenantId: string | null, id: string, actor: Actor) {
    await this.target(space, tenantId, id);
    const revoked = await this.sessions.revokeAll({ space, id });
    await this.audit(space, tenantId, actor, "security.revoke_sessions", id);
    return { revoked };
  }

  async setActive(space: Space, tenantId: string | null, id: string, isActive: boolean, actor: Actor) {
    if (actor.kind === space && actor.id === id && !isActive) throw new ConflictException("Vous ne pouvez pas désactiver votre propre compte");
    await this.target(space, tenantId, id);
    await this.repo.update(space, id, tenantId, { isActive });
    if (!isActive) await this.sessions.revokeAll({ space, id });
    await this.audit(space, tenantId, actor, isActive ? "security.activate" : "security.deactivate", id);
    return { ok: true, isActive };
  }

  private async audit(space: Space, tenantId: string | null, actor: Actor, action: string, entityId: string) {
    if (actor.kind === "platform") {
      await this.prisma.platformAuditLog.create({ data: { actorId: actor.id, action, entity: space === "platform" ? "PlatformUser" : "User", entityId, metadata: tenantId ? { tenantId } : undefined } });
    } else if (tenantId) {
      await this.prisma.asTenant(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId: actor.id, action, entity: "User", entityId } }));
    }
  }
}
