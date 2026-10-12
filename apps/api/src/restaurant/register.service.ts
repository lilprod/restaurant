import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService, Tx } from "../prisma/prisma.service";

/** Caisse : ouverture avec un fond, encaissements rattachés, clôture avec comptage et écart. */
@Injectable()
export class RegisterService {
  constructor(private readonly prisma: PrismaService) {}

  private async summary(tx: Tx, session: { id: string; opening: number }) {
    const payments = await tx.payment.findMany({ where: { registerSessionId: session.id, status: "PAID" }, select: { method: true, amount: true, tip: true, change: true } });
    const byMethod: Record<string, { amount: number; tips: number; count: number }> = {};
    for (const p of payments) {
      const m = (byMethod[p.method] ??= { amount: 0, tips: 0, count: 0 });
      m.amount += p.amount; m.tips += p.tip; m.count += 1;
    }
    const cash = byMethod.CASH;
    // Espèces attendues dans le tiroir : fond + encaissements espèces (pourboires espèces inclus, monnaie déjà rendue).
    const expectedCash = session.opening + (cash ? cash.amount + cash.tips : 0);
    return { byMethod, expectedCash, paymentsCount: payments.length, total: payments.reduce((n, p) => n + p.amount, 0) };
  }

  async current(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const s = await tx.registerSession.findFirst({ where: { tenantId, closedAt: null } });
      if (!s) return { open: false as const };
      return { open: true as const, session: s, ...(await this.summary(tx, s)) };
    });
  }

  async open(tenantId: string, userId: string, opening: number) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"register:" + tenantId}))`;   // une seule caisse ouverte
      if (await tx.registerSession.findFirst({ where: { tenantId, closedAt: null } })) throw new ConflictException("Une caisse est déjà ouverte");
      const s = await tx.registerSession.create({ data: { tenantId, openedById: userId, opening } });
      await tx.auditLog.create({ data: { tenantId, userId, action: "register.open", entity: "RegisterSession", entityId: s.id, metadata: { opening } } });
      return { open: true as const, session: s, ...(await this.summary(tx, s)) };
    });
  }

  async close(tenantId: string, userId: string, counted: number, notes?: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const s = await tx.registerSession.findFirst({ where: { tenantId, closedAt: null } });
      if (!s) throw new NotFoundException("Aucune caisse ouverte");
      const sum = await this.summary(tx, s);
      const closed = await tx.registerSession.update({
        where: { id: s.id },
        data: { closedAt: new Date(), closedById: userId, closing: counted, expectedCash: sum.expectedCash, difference: counted - sum.expectedCash, notes },
      });
      await tx.auditLog.create({ data: { tenantId, userId, action: "register.close", entity: "RegisterSession", entityId: s.id, metadata: { counted, expected: sum.expectedCash } } });
      return { session: closed, ...sum };
    });
  }

  history(tenantId: string, limit = 30) {
    return this.prisma.asTenant(tenantId, (tx) =>
      tx.registerSession.findMany({ where: { tenantId }, orderBy: { openedAt: "desc" }, take: limit }));
  }
}
