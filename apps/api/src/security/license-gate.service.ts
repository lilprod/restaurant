import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isAccessAllowed } from "../platform/licensing/licensing";

export interface LicenseInfo {
  status: string;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
  inGrace: boolean;
}

/** Bloque l'accès d'un restaurant dont la licence est expirée, ou qui est suspendu / résilié. */
@Injectable()
export class LicenseGateService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAccess(tenantId: string): Promise<LicenseInfo> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const sub = tenant?.subscriptions[0];
    if (!tenant || tenant.status === "CANCELLED") this.deny("Ce restaurant n'est plus actif.");
    if (tenant!.status === "PENDING") this.deny("Ce restaurant est en attente de validation.");
    if (tenant!.status === "SUSPENDED") this.deny("L'accès de ce restaurant est suspendu. Contactez l'éditeur.");
    if (!sub || !isAccessAllowed(sub.status)) this.deny("La licence de ce restaurant a expiré. Veuillez la renouveler.");
    return { status: sub!.status, currentPeriodEnd: sub!.currentPeriodEnd, graceEndsAt: sub!.graceEndsAt, inGrace: sub!.status === "GRACE" };
  }

  private deny(message: string): never {
    throw new ForbiddenException({ statusCode: 403, code: "LICENSE_BLOCKED", message });
  }
}
