import { Injectable } from "@nestjs/common";
import type { PasswordPolicy } from "@restaurant/utils";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_PLATFORM_SECURITY, DEFAULT_TENANT_SECURITY } from "../settings/defaults";
import { deepMerge } from "../settings/deep-merge";
import type { Space } from "./accounts.repo";

export interface ResolvedPolicy {
  passwordPolicy: PasswordPolicy;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  sessionDays: number;
  passwordExpiryDays: number;
  /** Ce rôle doit-il activer la double authentification ? */
  requires2fa: (role: string) => boolean;
}

const TTL_MS = 30_000;

/** Politique de sécurité effective (réglages enregistrés + valeurs par défaut), avec un court cache. */
@Injectable()
export class SecurityPolicyService {
  private cache = new Map<string, { at: number; policy: ResolvedPolicy }>();

  constructor(private readonly prisma: PrismaService) {}

  invalidate(space: Space, tenantId?: string | null) {
    this.cache.delete(`${space}:${tenantId ?? ""}`);
  }

  async get(space: Space, tenantId?: string | null): Promise<ResolvedPolicy> {
    const key = `${space}:${tenantId ?? ""}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.policy;

    const policy = space === "platform" ? await this.loadPlatform() : await this.loadTenant(tenantId!);
    this.cache.set(key, { at: Date.now(), policy });
    return policy;
  }

  private async loadPlatform(): Promise<ResolvedPolicy> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: "security" } });
    const s = deepMerge(DEFAULT_PLATFORM_SECURITY, row?.value);
    return { ...s, requires2fa: () => s.require2fa };
  }

  private async loadTenant(tenantId: string): Promise<ResolvedPolicy> {
    const row = await this.prisma.asTenant(tenantId, (tx) => tx.setting.findUnique({ where: { tenantId_key: { tenantId, key: "security" } } }));
    const s = deepMerge(DEFAULT_TENANT_SECURITY, row?.value);
    return { ...s, requires2fa: (role) => (s.require2faRoles as string[]).includes(role) };
  }
}
