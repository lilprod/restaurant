import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateStaffInput } from "@restaurant/validation";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../security/password.service";
import { SecurityPolicyService } from "../security/security-policy.service";
import { PlanLimitsService } from "./plan-limits.service";

const view = (u: { id: string; email: string; firstName: string; lastName: string; phone: string | null; role: string; isActive: boolean; twoFactorEnabled: boolean; lastLoginAt: Date | null; createdAt: Date; mustChangePassword: boolean }) => ({
  id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone, role: u.role,
  isActive: u.isActive, twoFactorEnabled: u.twoFactorEnabled, mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
});

/** Comptes du personnel d'un restaurant (la sécurité de ces comptes est gérée par AccountAdminService). */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly policies: SecurityPolicyService,
    private readonly limits: PlanLimitsService,
  ) {}

  async list(tenantId: string) {
    const users = await this.prisma.asTenant(tenantId, (tx) =>
      tx.user.findMany({ where: { tenantId, role: { not: "CUSTOMER" } }, orderBy: [{ isActive: "desc" }, { firstName: "asc" }] }));
    return users.map(view);
  }

  /** Crée le compte avec un mot de passe temporaire (affiché une fois) à changer à la première connexion. */
  async create(tenantId: string, input: CreateStaffInput, actorId: string) {
    const count = await this.prisma.asTenant(tenantId, (tx) => tx.user.count({ where: { tenantId, isActive: true, role: { not: "CUSTOMER" } } }));
    await this.limits.assertCanAdd(tenantId, "users", count);
    const temporaryPassword = this.passwords.generateTemporary(await this.policies.get("tenant", tenantId));
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const user = await this.prisma.asTenant(tenantId, async (tx) => {
      const u = await tx.user.create({
        data: {
          tenantId, email: input.email.toLowerCase(), firstName: input.firstName, lastName: input.lastName,
          phone: input.phone, role: input.role, passwordHash, mustChangePassword: true, passwordChangedAt: new Date(),
        },
      });
      await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "staff.create", entity: "User", entityId: u.id, metadata: { role: u.role } } });
      return u;
    });
    return { ...view(user), temporaryPassword };
  }

  async update(tenantId: string, id: string, patch: { firstName?: string; lastName?: string; phone?: string; role?: string }, actorId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { id, tenantId, role: { not: "CUSTOMER" } } });
      if (!u) throw new NotFoundException("Membre introuvable");
      if (patch.role && patch.role !== u.role && id === actorId) throw new ConflictException("Vous ne pouvez pas changer votre propre rôle");
      const updated = await tx.user.update({ where: { id }, data: patch as never });
      await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "staff.update", entity: "User", entityId: id, metadata: patch } });
      return view(updated);
    });
  }
}
