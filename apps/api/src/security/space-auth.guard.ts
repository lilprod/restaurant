import {
  CanActivate, ExecutionContext, ForbiddenException, SetMetadata, UnauthorizedException, createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { Account, AccountsRepo, Space } from "./accounts.repo";
import { LicenseGateService, LicenseInfo } from "./license-gate.service";
import { isLocked } from "./lockout";
import { restrictionFor } from "./restrictions";
import { SecurityPolicyService } from "./security-policy.service";
import { AccessClaims, SessionService } from "./session.service";

export interface AuthedRequest extends Request {
  account: Account;
  sessionId: string;
  license?: LicenseInfo;
}

const ROLES_KEY = "roles";
const ALLOW_RESTRICTED_KEY = "allowRestricted";

/** Restreint une route à certains rôles (rôles plateforme ou rôles de restaurant selon l'espace). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
/** Route accessible même si la session est restreinte (mot de passe à changer, 2FA à activer). */
export const AllowRestricted = () => SetMetadata(ALLOW_RESTRICTED_KEY, true);

export const CurrentAccount = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Account => ctx.switchToHttp().getRequest<AuthedRequest>().account,
);
export const CurrentSessionId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<AuthedRequest>().sessionId,
);

/** Garde commune : jeton valide, session non révoquée, compte actif, licence valide (restaurants), rôle, restrictions. */
export abstract class SpaceAuthGuard implements CanActivate {
  protected abstract readonly space: Space;

  constructor(
    protected readonly jwt: JwtService,
    protected readonly sessions: SessionService,
    protected readonly repo: AccountsRepo,
    protected readonly policies: SecurityPolicyService,
    protected readonly gate: LicenseGateService,
    protected readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Authentification requise");

    let claims: AccessClaims;
    try { claims = await this.jwt.verifyAsync(header.slice(7)); } catch { throw new UnauthorizedException("Jeton invalide ou expiré"); }
    if (claims.typ !== this.space || !claims.sid || (this.space === "tenant" && !claims.tid)) throw new UnauthorizedException("Jeton invalide");

    if (!(await this.sessions.isActive(claims.sid, claims.sub))) throw new UnauthorizedException("Session terminée");
    const acc = await this.repo.findById(this.space, claims.sub, claims.tid);
    if (!acc?.isActive || isLocked(acc.lockedUntil, new Date())) throw new UnauthorizedException("Compte indisponible");
    if (acc.tenantId) req.license = await this.gate.assertAccess(acc.tenantId);

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(acc.role)) throw new ForbiddenException("Droits insuffisants");

    const allowRestricted = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_RESTRICTED_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!allowRestricted) {
      const restriction = restrictionFor(acc, await this.policies.get(this.space, acc.tenantId));
      if (restriction) {
        throw new ForbiddenException({
          statusCode: 403, code: "RESTRICTED_SESSION", restriction,
          message: restriction === "pwd-change" ? "Vous devez changer votre mot de passe." : "La double authentification est obligatoire pour votre rôle.",
        });
      }
    }
    req.account = acc;
    req.sessionId = claims.sid;
    return true;
  }
}
