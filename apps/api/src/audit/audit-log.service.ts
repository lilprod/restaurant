import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuditLogQuery } from "@restaurant/validation";
import { PrismaService } from "../prisma/prisma.service";

const person = { select: { id: true, firstName: true, lastName: true, email: true } } as const;

function range(q: AuditLogQuery) {
  return q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {};
}
function filters(q: AuditLogQuery) {
  return {
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...range(q),
  };
}
const page = (q: AuditLogQuery) => ({ orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], skip: (q.page - 1) * q.pageSize, take: q.pageSize });

/** Consultation des journaux d'audit : restaurant (administrateur) et plateforme (SuperAdmin). Lecture seule. */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Journal d'un restaurant (sous RLS quand l'appelant est le restaurant, en mode plateforme pour le SuperAdmin). */
  async tenantLogs(tenantId: string, q: AuditLogQuery, asPlatform = false) {
    const where: Prisma.AuditLogWhereInput = { tenantId, ...filters(q), ...(q.userId ? { userId: q.userId } : {}) };
    const run = async (tx: Prisma.TransactionClient) => {
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({ where, ...page(q), include: { user: person } }),
      ]);
      const items = rows.map((r) => ({
        id: r.id, action: r.action, entity: r.entity, entityId: r.entityId, metadata: r.metadata, ip: r.ip, createdAt: r.createdAt,
        user: r.user ? { id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}`.trim(), email: r.user.email } : null,
      }));
      return { items, total, page: q.page, pageSize: q.pageSize };
    };
    if (!asPlatform) return this.prisma.asTenant(tenantId, run);
    return this.prisma.asPlatform(async (tx) => {
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw new NotFoundException("Restaurant introuvable");
      return run(tx);
    });
  }

  /** Journal de la plateforme (actions de l'équipe de l'éditeur). */
  async platformLogs(q: AuditLogQuery) {
    const where: Prisma.PlatformAuditLogWhereInput = { ...filters(q), ...(q.userId ? { actorId: q.userId } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.platformAuditLog.count({ where }),
      this.prisma.platformAuditLog.findMany({ where, ...page(q), include: { actor: person } }),
    ]);
    const items = rows.map((r) => ({
      id: r.id, action: r.action, entity: r.entity, entityId: r.entityId, metadata: r.metadata, createdAt: r.createdAt,
      user: r.actor ? { id: r.actor.id, name: `${r.actor.firstName} ${r.actor.lastName}`.trim(), email: r.actor.email } : null,
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
