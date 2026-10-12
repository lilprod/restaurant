import { Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { PlatformRole } from "@restaurant/shared-types";
import type { Account, Space } from "../../security/accounts.repo";
import { AccountsRepo } from "../../security/accounts.repo";
import { LicenseGateService } from "../../security/license-gate.service";
import { SecurityPolicyService } from "../../security/security-policy.service";
import { SessionService } from "../../security/session.service";
import { CurrentAccount, Roles, SpaceAuthGuard } from "../../security/space-auth.guard";

/** Compte de l'espace plateforme authentifié (alias conservé pour les contrôleurs existants). */
export type PlatformPrincipal = Account & { role: PlatformRole };
export const CurrentPlatformUser = CurrentAccount;
/** Restreint une route à certains rôles plateforme (par défaut : tout rôle plateforme authentifié). */
export const PlatformRoles = (...roles: PlatformRole[]) => Roles(...roles);

@Injectable()
export class PlatformAuthGuard extends SpaceAuthGuard {
  protected readonly space: Space = "platform";
  constructor(jwt: JwtService, sessions: SessionService, repo: AccountsRepo, policies: SecurityPolicyService, gate: LicenseGateService, reflector: Reflector) {
    super(jwt, sessions, repo, policies, gate, reflector);
  }
}
