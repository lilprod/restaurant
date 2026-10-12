import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type Space = "platform" | "tenant";

/** Compte normalisé : un utilisateur de la plateforme (PlatformUser) ou d'un restaurant (User). */
export interface Account {
  id: string;
  space: Space;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  locale: string;
  role: string;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
  recoveryCodeHashes: string[];
  avatarUrl: string | null;
  createdAt: Date;
}

export type AccountUpdate = Partial<Pick<Account,
  "firstName" | "lastName" | "phone" | "locale" | "passwordHash" | "isActive" | "mustChangePassword" |
  "passwordChangedAt" | "failedLoginCount" | "lockedUntil" | "lastLoginAt" | "twoFactorEnabled" |
  "twoFactorSecret" | "recoveryCodeHashes" | "avatarUrl" | "role">> & { lastLoginIp?: string | null };

/** Accès unifié aux comptes des deux espaces (le tenant passe par la RLS via `asTenant`). */
@Injectable()
export class AccountsRepo {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(space: Space, email: string, tenantId?: string | null): Promise<Account | null> {
    const e = email.trim().toLowerCase();
    if (space === "platform") {
      const u = await this.prisma.platformUser.findUnique({ where: { email: e } });
      return u && { ...u, space, tenantId: null };
    }
    const tid = tenantId!;
    const u = await this.prisma.asTenant(tid, (tx) => tx.user.findUnique({ where: { tenantId_email: { tenantId: tid, email: e } } }));
    return u && { ...u, space, tenantId: tid };
  }

  async findById(space: Space, id: string, tenantId?: string | null): Promise<Account | null> {
    if (space === "platform") {
      const u = await this.prisma.platformUser.findUnique({ where: { id } });
      return u && { ...u, space, tenantId: null };
    }
    const tid = tenantId!;
    const u = await this.prisma.asTenant(tid, (tx) => tx.user.findFirst({ where: { id, tenantId: tid } }));
    return u && { ...u, space, tenantId: tid };
  }

  async update(space: Space, id: string, tenantId: string | null | undefined, data: AccountUpdate): Promise<void> {
    if (space === "platform") {
      await this.prisma.platformUser.update({ where: { id }, data: data as never });
      return;
    }
    const tid = tenantId!;
    await this.prisma.asTenant(tid, (tx) => tx.user.updateMany({ where: { id, tenantId: tid }, data: data as never }));
  }
}
