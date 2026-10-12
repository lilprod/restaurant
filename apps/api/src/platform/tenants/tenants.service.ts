import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import * as argon2 from "argon2";
import { DEFAULT_PASSWORD_POLICY, validatePassword } from "@restaurant/utils";
import type { CreateTenantInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../../prisma/prisma.service";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { addDays, isAccessAllowed } from "../licensing/licensing";

/** Sous-domaines interdits (réservés à la plateforme). */
const RESERVED_SLUGS = new Set(["www", "api", "admin", "app", "platform", "superadmin", "mail", "static", "assets", "docs", "status"]);

export interface ProvisionInput {
  name: string;
  slug: string;
  email: string;
  phone?: string;
  address?: string;
  planId: string;
  admin: { firstName: string; lastName: string; email: string; passwordHash: string };
  /** Mot de passe choisi par le SuperAdmin : l'administrateur du restaurant devra le changer à sa première connexion. */
  forcePasswordChange?: boolean;
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: PlatformAuditService) {}

  /** Création par le SuperAdmin. */
  async create(input: CreateTenantInput, actorId: string) {
    const { password, ...admin } = input.admin;
    const weak = validatePassword(password, DEFAULT_PASSWORD_POLICY, { email: admin.email, names: [admin.firstName, admin.lastName] });
    if (weak.length) throw new BadRequestException({ message: "Mot de passe trop faible", errors: weak.map((message) => ({ path: "admin.password", message })) });
    const passwordHash = await argon2.hash(password);
    return this.prisma.asPlatform(async (tx) => {
      const tenant = await this.provision(tx, { ...input, admin: { ...admin, passwordHash }, forcePasswordChange: true });
      await this.audit.log({ actorId, action: "tenant.create", entity: "Tenant", entityId: tenant.id }, tx);
      return this.detail(tx, tenant.id);
    });
  }

  /**
   * Crée le tenant, son administrateur et sa licence d'essai (réutilisé par l'approbation d'une inscription).
   * Plan sans essai (trialDays = 0) : le tenant est créé suspendu, un premier paiement l'active.
   */
  async provision(tx: Tx, input: ProvisionInput) {
    const slug = input.slug.toLowerCase();
    if (RESERVED_SLUGS.has(slug)) throw new ConflictException("Ce sous-domaine est réservé");
    if (await tx.tenant.findUnique({ where: { slug } })) throw new ConflictException("Ce sous-domaine est déjà pris");

    const plan = await tx.plan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) throw new NotFoundException("Plan introuvable ou désactivé");

    const now = new Date();
    const trial = plan.trialDays > 0;
    const trialEndsAt = addDays(now, plan.trialDays);

    const tenant = await tx.tenant.create({
      data: {
        name: input.name,
        slug,
        email: input.email.toLowerCase(),
        phone: input.phone,
        address: input.address,
        status: trial ? "TRIAL" : "SUSPENDED",
      },
    });
    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: input.admin.email.toLowerCase(),
        passwordHash: input.admin.passwordHash,
        firstName: input.admin.firstName,
        lastName: input.admin.lastName,
        role: "ADMIN",
        consentAt: now,
        passwordChangedAt: now,
        mustChangePassword: input.forcePasswordChange ?? false,
      },
    });
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: trial ? "TRIALING" : "EXPIRED",
        billingCycle: "MONTHLY",
        startsAt: now,
        trialEndsAt: trial ? trialEndsAt : null,
        currentPeriodEnd: trial ? trialEndsAt : now,
      },
    });
    return tenant;
  }

  async list(q: { status?: string; search?: string; page: number; pageSize: number }) {
    const where: Prisma.TenantWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.search
        ? { OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { slug: { contains: q.search, mode: "insensitive" } },
            { email: { contains: q.search, mode: "insensitive" } },
          ] }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: { select: { code: true, name: true } } } } },
      }),
    ]);
    return {
      total, page: q.page, pageSize: q.pageSize,
      items: items.map(({ subscriptions, ...t }) => ({ ...t, subscription: subscriptions[0] ?? null })),
    };
  }

  get(id: string) {
    return this.prisma.asPlatform((tx) => this.detail(tx, id));
  }

  private async detail(tx: Tx, id: string) {
    const tenant = await tx.tenant.findUnique({
      where: { id },
      include: { subscriptions: { orderBy: { createdAt: "desc" }, take: 1, include: { plan: true } } },
    });
    if (!tenant) throw new NotFoundException("Restaurant introuvable");
    const [users, payments] = await Promise.all([
      tx.user.count({ where: { tenantId: id } }),
      tx.subscriptionPayment.count({ where: { tenantId: id, status: "RECORDED" } }),
    ]);
    const { subscriptions, ...rest } = tenant;
    return { ...rest, subscription: subscriptions[0] ?? null, usersCount: users, paymentsCount: payments };
  }

  async update(id: string, data: Prisma.TenantUpdateInput, actorId: string) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id } });
    const tenant = await this.prisma.tenant.update({ where: { id }, data });
    await this.audit.log({ actorId, action: "tenant.update", entity: "Tenant", entityId: id });
    return tenant;
  }

  async subscriptions(id: string) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id } });
    return this.prisma.subscription.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: "desc" },
      include: { plan: { select: { code: true, name: true } }, payments: { orderBy: { paidAt: "desc" } } },
    });
  }

  /** Suspension manuelle (impayé constaté, abus…). Un paiement ne la lève pas automatiquement. */
  async suspend(id: string, actorId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id } });
    if (tenant.status === "CANCELLED") throw new ConflictException("Ce restaurant est résilié");
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: "SUSPENDED" } });
    await this.audit.log({ actorId, action: "tenant.suspend", entity: "Tenant", entityId: id });
    return updated;
  }

  /** Lève une suspension manuelle, à condition que la licence donne encore accès. */
  async reactivate(id: string, actorId: string) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id } });
    const sub = await this.prisma.subscription.findFirst({ where: { tenantId: id }, orderBy: { createdAt: "desc" } });
    if (!sub || !isAccessAllowed(sub.status)) {
      throw new ConflictException("La licence est expirée : enregistrez un paiement pour réactiver ce restaurant");
    }
    const status = sub.status === "TRIALING" ? "TRIAL" : "ACTIVE";
    const updated = await this.prisma.tenant.update({ where: { id }, data: { status } });
    await this.audit.log({ actorId, action: "tenant.reactivate", entity: "Tenant", entityId: id });
    return updated;
  }
}
