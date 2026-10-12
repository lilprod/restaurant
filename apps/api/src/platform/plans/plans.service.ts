import { Injectable, NotFoundException } from "@nestjs/common";
import type { PlanInput } from "@restaurant/validation";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../audit/platform-audit.service";

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService, private readonly audit: PlatformAuditService) {}

  list() {
    return this.prisma.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }] });
  }

  /** Plans proposés sur le formulaire d'inscription public. */
  listPublic() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }],
      select: {
        id: true, code: true, name: true, description: true, priceMonthly: true, priceYearly: true,
        trialDays: true, maxUsers: true, maxTables: true, features: true,
      },
    });
  }

  async get(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("Plan introuvable");
    return plan;
  }

  async create(input: PlanInput, actorId: string) {
    const plan = await this.prisma.plan.create({ data: input });
    await this.audit.log({ actorId, action: "plan.create", entity: "Plan", entityId: plan.id });
    return plan;
  }

  /** Les plans ne sont jamais supprimés (historique des licences) : on les désactive. */
  async update(id: string, input: Partial<PlanInput>, actorId: string) {
    await this.get(id);
    const plan = await this.prisma.plan.update({ where: { id }, data: input });
    await this.audit.log({ actorId, action: "plan.update", entity: "Plan", entityId: id, metadata: input as object });
    return plan;
  }
}
