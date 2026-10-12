import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import type { RegistrationInput } from "@restaurant/validation";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { TenantsService } from "../tenants/tenants.service";

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: PlatformAuditService,
  ) {}

  /** Inscription publique : crée une demande en attente de validation (aucun tenant n'existe encore). */
  async submit(input: RegistrationInput) {
    const slug = input.slug.toLowerCase();
    const [tenant, pending] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { slug } }),
      this.prisma.tenantRegistration.findFirst({ where: { slug, status: "PENDING" } }),
    ]);
    if (tenant || pending) throw new ConflictException("Ce sous-domaine est déjà pris");

    if (input.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: input.planId } });
      if (!plan?.isActive) throw new NotFoundException("Plan introuvable");
    }
    const reg = await this.prisma.tenantRegistration.create({
      data: {
        restaurantName: input.restaurantName,
        slug,
        ownerFirstName: input.ownerFirstName,
        ownerLastName: input.ownerLastName,
        email: input.email.toLowerCase(),
        phone: input.phone,
        passwordHash: await argon2.hash(input.password),
        planId: input.planId,
      },
    });
    return { id: reg.id, status: reg.status, message: "Demande reçue. Vous serez contacté après validation." };
  }

  async list(status?: string) {
    const rows = await this.prisma.tenantRegistration.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: "desc" },
    });
    return rows.map(({ passwordHash: _hidden, ...rest }) => rest);
  }

  /** Validation : crée le tenant, son admin et l'essai gratuit, de façon atomique. */
  async approve(id: string, actorId: string, planId?: string) {
    return this.prisma.asPlatform(async (tx) => {
      // Verrou optimiste : une seule validation peut passer la demande de PENDING à APPROVED.
      const claimed = await tx.tenantRegistration.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date() },
      });
      if (claimed.count === 0) {
        const exists = await tx.tenantRegistration.findUnique({ where: { id } });
        if (!exists) throw new NotFoundException("Demande introuvable");
        throw new ConflictException("Cette demande a déjà été traitée");
      }
      const reg = await tx.tenantRegistration.findUniqueOrThrow({ where: { id } });

      let chosenPlanId = planId ?? reg.planId;
      if (!chosenPlanId) {
        const first = await tx.plan.findFirst({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }] });
        if (!first) throw new ConflictException("Aucun plan actif : créez un plan avant de valider");
        chosenPlanId = first.id;
      }
      const tenant = await this.tenants.provision(tx, {
        name: reg.restaurantName,
        slug: reg.slug,
        email: reg.email,
        phone: reg.phone ?? undefined,
        planId: chosenPlanId,
        admin: { firstName: reg.ownerFirstName, lastName: reg.ownerLastName, email: reg.email, passwordHash: reg.passwordHash },
      });
      await tx.tenantRegistration.update({ where: { id }, data: { tenantId: tenant.id, planId: chosenPlanId } });
      await this.audit.log({ actorId, action: "registration.approve", entity: "TenantRegistration", entityId: id, metadata: { tenantId: tenant.id } }, tx);
      return { registrationId: id, tenantId: tenant.id, slug: tenant.slug, status: tenant.status };
    });
  }

  async reject(id: string, reason: string, actorId: string) {
    const res = await this.prisma.tenantRegistration.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", rejectionReason: reason, reviewedById: actorId, reviewedAt: new Date() },
    });
    if (res.count === 0) {
      if (!(await this.prisma.tenantRegistration.findUnique({ where: { id } }))) throw new NotFoundException("Demande introuvable");
      throw new ConflictException("Cette demande a déjà été traitée");
    }
    await this.audit.log({ actorId, action: "registration.reject", entity: "TenantRegistration", entityId: id, metadata: { reason } });
    return { id, status: "REJECTED" };
  }
}
