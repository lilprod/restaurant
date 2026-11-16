import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ListReviewsQuery, PublicReviewsQuery, ReviewInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import type { Account } from "../security/accounts.repo";
import { LicenseGateService } from "../security/license-gate.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { ReviewSummary, reviewSummary } from "./review-stats";
import { TrackingService } from "./tracking.service";
import { publicReviewView, reviewInclude, reviewView } from "./views";

const DUPLICATE = "Un avis a déjà été donné pour cette commande";

/** Avis des clients : dépôt (lien du ticket ou compte), modération, réponse publique, statistiques, affichage public. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
    private readonly settings: TenantSettingsService,
    private readonly gate: LicenseGateService,
  ) {}

  // ── Dépôt ──

  private async create(tenantId: string, orderId: string, input: ReviewInput, author: { customerId?: string; name?: string }) {
    try {
      await this.prisma.asTenant(tenantId, async (tx) => {
        const o = await tx.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true, closedAt: true, cancelledAt: true } });
        if (!o) throw new NotFoundException("Commande introuvable");
        if (!o.closedAt || o.cancelledAt) throw new ConflictException("Vous pourrez donner votre avis une fois la commande terminée et réglée");
        await tx.feedback.create({
          data: { tenantId, orderId, rating: input.rating, comment: input.comment, customerId: author.customerId ?? null, authorName: author.name ?? null },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException(DUPLICATE);
      throw e;
    }
  }

  /** Avis déposé avec le lien du ticket (sans compte). */
  async submitByToken(token: string, input: ReviewInput) {
    const { order } = await this.tracking.byToken(token);
    await this.create(order.tenantId, order.id, input, { name: input.authorName });
    return this.tracking.view(token);
  }

  /** Avis déposé depuis l'espace client : la commande doit être celle du client (ou d'une de ses réservations). */
  async submitForCustomer(acc: Account, orderId: string, input: ReviewInput) {
    const tenantId = acc.tenantId!;
    const own = await this.prisma.asTenant(tenantId, (tx) => tx.order.findFirst({ where: { id: orderId, tenantId, ...this.mine(acc.id) }, select: { id: true } }));
    if (!own) throw new NotFoundException("Commande introuvable");
    await this.create(tenantId, orderId, input, { customerId: acc.id, name: acc.firstName });
    return (await this.customerOrders(acc)).find((o) => o.id === orderId);
  }

  private mine = (customerId: string): Prisma.OrderWhereInput => ({ OR: [{ customerId }, { reservation: { customerId } }] });

  /** Commandes du client avec son avis (ou la possibilité d'en laisser un). */
  async customerOrders(acc: Account) {
    const tenantId = acc.tenantId!;
    const rows = await this.prisma.asTenant(tenantId, (tx) => tx.order.findMany({
      where: { tenantId, cancelledAt: null, ...this.mine(acc.id) }, orderBy: { createdAt: "desc" }, take: 50,
      include: {
        items: { where: { parentItemId: null, status: { not: "CANCELLED" } }, select: { name: true, quantity: true }, take: 6 },
        feedback: { select: { rating: true, comment: true, reply: true, hiddenAt: true, createdAt: true } },
      },
    }));
    return rows.map((o) => ({
      id: o.id, number: o.number, type: o.type, total: o.total, createdAt: o.createdAt, closedAt: o.closedAt,
      status: o.status, items: o.items, canReview: !!o.closedAt && !o.feedback,
      review: o.feedback && { rating: o.feedback.rating, comment: o.feedback.comment, reply: o.feedback.hiddenAt ? null : o.feedback.reply, createdAt: o.feedback.createdAt },
    }));
  }

  // ── Restaurant (responsables) ──

  async list(tenantId: string, q: ListReviewsQuery) {
    const where: Prisma.FeedbackWhereInput = {
      tenantId,
      ...(q.status === "visible" ? { hiddenAt: null } : q.status === "hidden" ? { hiddenAt: { not: null } } : {}),
      ...(q.rating ? { rating: q.rating } : {}),
      ...(q.unanswered ? { reply: null } : {}),
    };
    const [total, rows] = await this.prisma.asTenant(tenantId, (tx) => Promise.all([
      tx.feedback.count({ where }),
      tx.feedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: reviewInclude }),
    ]));
    return { items: rows.map(reviewView), total, page: q.page, pageSize: q.pageSize };
  }

  /** Statistiques : tous les avis reçus, et ce que voit le public (hors avis masqués). */
  async stats(tenantId: string) {
    return this.prisma.asTenant(tenantId, async (tx) => {
      const [all, visible, unanswered] = await Promise.all([
        reviewSummary(tx, tenantId, false), reviewSummary(tx, tenantId, true),
        tx.feedback.count({ where: { tenantId, reply: null, hiddenAt: null } }),
      ]);
      return { ...all, visible, hiddenCount: all.count - visible.count, unanswered };
    });
  }

  private async mutate(acc: Account, id: string, fn: (tx: Tx) => Promise<void>) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      const r = await tx.feedback.findFirst({ where: { id, tenantId }, select: { id: true } });
      if (!r) throw new NotFoundException("Avis introuvable");
      await fn(tx);
      return reviewView(await tx.feedback.findFirstOrThrow({ where: { id, tenantId }, include: reviewInclude }));
    });
  }

  private audit(tx: Tx, acc: Account, action: string, id: string, metadata: Prisma.InputJsonValue = {}) {
    return tx.auditLog.create({ data: { tenantId: acc.tenantId!, userId: acc.id, action, entity: "Feedback", entityId: id, metadata } });
  }

  hide(acc: Account, id: string, hidden: boolean) {
    return this.mutate(acc, id, async (tx) => {
      await tx.feedback.update({ where: { id }, data: hidden ? { hiddenAt: new Date(), hiddenById: acc.id } : { hiddenAt: null, hiddenById: null } });
      await this.audit(tx, acc, hidden ? "review.hide" : "review.unhide", id);
    });
  }

  reply(acc: Account, id: string, text: string | null) {
    return this.mutate(acc, id, async (tx) => {
      await tx.feedback.update({ where: { id }, data: text ? { reply: text, repliedAt: new Date(), repliedById: acc.id } : { reply: null, repliedAt: null, repliedById: null } });
      await this.audit(tx, acc, text ? "review.reply" : "review.reply_delete", id);
    });
  }

  // ── Public ──

  /** Avis publiés du restaurant ; vide si le restaurant n'a pas activé l'affichage. */
  async publicList(slug: string, q: PublicReviewsQuery): Promise<{ enabled: boolean; summary: ReviewSummary | null; items: ReturnType<typeof publicReviewView>[]; total: number; page: number; pageSize: number }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!tenant) throw new NotFoundException("Restaurant introuvable");
    try { await this.gate.assertAccess(tenant.id); } catch { throw new NotFoundException("Avis indisponibles"); }
    const ops = await this.settings.getSection("operations", tenant) as { publicReviews?: boolean };
    if (!ops.publicReviews) return { enabled: false, summary: null, items: [], total: 0, page: q.page, pageSize: q.pageSize };
    return this.prisma.asTenant(tenant.id, async (tx) => {
      const where = { tenantId: tenant.id, hiddenAt: null };
      const [summary, rows] = await Promise.all([
        reviewSummary(tx, tenant.id, true),
        tx.feedback.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: reviewInclude }),
      ]);
      return { enabled: true, summary, items: rows.map(publicReviewView), total: summary.count, page: q.page, pageSize: q.pageSize };
    });
  }
}

