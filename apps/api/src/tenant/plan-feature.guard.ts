import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";

const KEY = "planFeature";
const LABELS: Record<string, string> = { inventory: "Stock", staff: "Personnel", reports: "Rapports", delivery: "Livraison", reservations: "Réservations" };

/** Réserve un contrôleur / une route aux plans dont `features[feature] === true` (à placer après `TenantAuthGuard`). */
export const PlanFeature = (feature: string) => SetMetadata(KEY, feature);

/** Refuse avec `403 {code: "PLAN_FEATURE"}` si le plan souscrit n'inclut pas le module. */
@Injectable()
export class PlanFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string | undefined>(KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!feature) return true;
    const acc = ctx.switchToHttp().getRequest<{ account?: Account }>().account;
    if (!acc?.tenantId) return false;
    const sub = await this.prisma.subscription.findFirst({ where: { tenantId: acc.tenantId }, orderBy: { createdAt: "desc" }, include: { plan: true } });
    const features = (sub?.plan.features ?? {}) as Record<string, unknown>;
    if (features[feature] === true) return true;
    throw new ForbiddenException({
      statusCode: 403, code: "PLAN_FEATURE", feature,
      message: `Le module ${LABELS[feature] ?? feature} n'est pas inclus dans votre plan${sub ? ` ${sub.plan.name}` : ""}. Passez à un plan supérieur pour l'activer.`,
    });
  }
}
