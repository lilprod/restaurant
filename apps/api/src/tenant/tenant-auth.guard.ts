import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AccountsRepo, Space } from "../security/accounts.repo";
import { LicenseGateService } from "../security/license-gate.service";
import { SecurityPolicyService } from "../security/security-policy.service";
import { SessionService } from "../security/session.service";
import { Roles, SpaceAuthGuard } from "../security/space-auth.guard";

export type TenantRole = "ADMIN" | "MANAGER" | "WAITER" | "KITCHEN" | "CUSTOMER";
/** Restreint une route à certains rôles d'un restaurant. */
export const TenantRoles = (...roles: TenantRole[]) => Roles(...roles);

/** Authentifie un utilisateur de restaurant et bloque l'accès si la licence du restaurant n'est plus valide. */
@Injectable()
export class TenantAuthGuard extends SpaceAuthGuard {
  protected readonly space: Space = "tenant";
  constructor(jwt: JwtService, sessions: SessionService, repo: AccountsRepo, policies: SecurityPolicyService, gate: LicenseGateService, reflector: Reflector) {
    super(jwt, sessions, repo, policies, gate, reflector);
  }
}
