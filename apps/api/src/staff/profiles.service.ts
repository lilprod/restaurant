import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { KioskCodeInput, StaffProfileInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { PasswordService } from "../security/password.service";
import { dayToDate } from "./staff.common";
import { profileView } from "./staff.views";

/** Fiches RH liées aux comptes, et code personnel de pointage (haché, jamais renvoyé). */
@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService) {}

  async list(acc: Account) {
    const tenantId = acc.tenantId!;
    const users = await this.prisma.asTenant(tenantId, (tx) => tx.user.findMany({
      where: { tenantId, role: { not: "CUSTOMER" } }, include: { staffProfile: true }, orderBy: [{ isActive: "desc" }, { firstName: "asc" }],
    }));
    return users.map((u) => profileView(u, u.staffProfile, acc.role === "ADMIN"));
  }

  private async user(tx: Tx, tenantId: string, userId: string) {
    const u = await tx.user.findFirst({ where: { id: userId, tenantId, role: { not: "CUSTOMER" } }, include: { staffProfile: true } });
    if (!u) throw new NotFoundException("Membre introuvable");
    return u;
  }

  async get(acc: Account, userId: string) {
    const u = await this.prisma.asTenant(acc.tenantId!, (tx) => this.user(tx, acc.tenantId!, userId));
    return profileView(u, u.staffProfile, acc.role === "ADMIN");
  }

  /** Mon profil (la personne voit son propre taux). */
  async mine(acc: Account) {
    const u = await this.prisma.asTenant(acc.tenantId!, (tx) => this.user(tx, acc.tenantId!, acc.id));
    return profileView(u, u.staffProfile, true);
  }

  async upsert(acc: Account, userId: string, input: StaffProfileInput) {
    const tenantId = acc.tenantId!;
    if ((input.hourlyRate !== undefined || input.overtimeMultiplier !== undefined) && acc.role !== "ADMIN") {
      throw new ForbiddenException("Seul l'administrateur modifie le taux horaire");
    }
    return this.prisma.asTenant(tenantId, async (tx) => {
      const u = await this.user(tx, tenantId, userId);
      const data = {
        position: input.position, contractType: input.contractType, contractEndsAt: input.contractEndsAt ? dayToDate(input.contractEndsAt) : null,
        hiredAt: dayToDate(input.hiredAt), emergencyContact: input.emergencyContact ?? null, notes: input.notes ?? null,
        ...(input.hourlyRate !== undefined ? { hourlyRate: input.hourlyRate } : {}),
        ...(input.overtimeMultiplier !== undefined ? { overtimeMultiplier: input.overtimeMultiplier } : {}),
      };
      const p = u.staffProfile
        ? await tx.staffProfile.update({ where: { id: u.staffProfile.id }, data })
        : await tx.staffProfile.create({ data: { ...data, tenantId, userId, hourlyRate: input.hourlyRate ?? 0 } });
      const { hourlyRate, overtimeMultiplier, ...safe } = input;
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: u.staffProfile ? "staff.profile.update" : "staff.profile.create", entity: "StaffProfile", entityId: p.id, metadata: { ...safe, rateChanged: hourlyRate !== undefined || overtimeMultiplier !== undefined } } });
      return profileView(u, p, acc.role === "ADMIN");
    });
  }

  private async profileOf(tx: Tx, tenantId: string, userId: string) {
    const u = await this.user(tx, tenantId, userId);
    if (!u.staffProfile) throw new ConflictException("Créez d'abord la fiche de cette personne");
    return u.staffProfile;
  }

  async setKioskCode(acc: Account, userId: string, { code }: KioskCodeInput) {
    const tenantId = acc.tenantId!;
    const hash = await this.passwords.hash(code);
    await this.prisma.asTenant(tenantId, async (tx) => {
      const p = await this.profileOf(tx, tenantId, userId);
      await tx.staffProfile.update({ where: { id: p.id }, data: { kioskPinHash: hash, kioskFailedCount: 0, kioskLockedUntil: null } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.kiosk.code-set", entity: "StaffProfile", entityId: p.id } });
    });
    return { ok: true };
  }

  async clearKioskCode(acc: Account, userId: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const p = await this.profileOf(tx, tenantId, userId);
      await tx.staffProfile.update({ where: { id: p.id }, data: { kioskPinHash: null, kioskFailedCount: 0, kioskLockedUntil: null } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.kiosk.code-removed", entity: "StaffProfile", entityId: p.id } });
    });
    return { ok: true };
  }

  async unlockKiosk(acc: Account, userId: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      const p = await this.profileOf(tx, tenantId, userId);
      await tx.staffProfile.update({ where: { id: p.id }, data: { kioskFailedCount: 0, kioskLockedUntil: null } });
      await tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "staff.kiosk.unlock", entity: "StaffProfile", entityId: p.id } });
    });
    return { ok: true };
  }
}
