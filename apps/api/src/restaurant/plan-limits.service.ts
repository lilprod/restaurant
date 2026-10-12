import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Limites du plan souscrit (nombre d'utilisateurs, de tables). `null` = illimité. */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  private async plan(tenantId: string) {
    const sub = await this.prisma.subscription.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { plan: true } });
    return sub?.plan ?? null;
  }

  async assertCanAdd(tenantId: string, what: "users" | "tables", currentCount: number) {
    const plan = await this.plan(tenantId);
    const max = what === "users" ? plan?.maxUsers : plan?.maxTables;
    if (max != null && currentCount >= max) {
      const label = what === "users" ? "utilisateurs" : "tables";
      throw new ConflictException({
        statusCode: 409, code: "PLAN_LIMIT",
        message: `Votre plan ${plan!.name} est limité à ${max} ${label}. Passez à un plan supérieur pour en ajouter.`,
      });
    }
  }
}
