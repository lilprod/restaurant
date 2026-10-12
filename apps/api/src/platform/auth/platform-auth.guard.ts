import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { PlatformRole } from "@restaurant/shared-types";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";

export interface PlatformPrincipal {
  id: string;
  email: string;
  role: PlatformRole;
}
export type PlatformRequest = Request & { platformUser: PlatformPrincipal };

const ROLES_KEY = "platformRoles";
/** Restreint une route à certains rôles plateforme (par défaut : tout rôle plateforme authentifié). */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PlatformRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Authentification requise");

    let payload: { sub: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
    } catch {
      throw new UnauthorizedException("Jeton invalide ou expiré");
    }
    if (payload.typ !== "platform") throw new UnauthorizedException("Jeton invalide");

    const user = await this.prisma.platformUser.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException("Compte désactivé");

    const roles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException("Droits insuffisants");

    req.platformUser = { id: user.id, email: user.email, role: user.role };
    return true;
  }
}
