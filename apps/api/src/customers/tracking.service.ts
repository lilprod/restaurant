import { ConflictException, GoneException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Account } from "../security/accounts.repo";
import { createHash, createHmac } from "node:crypto";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { ORDER_TYPES } from "./views";

const DAY = 86_400_000;
/** Un lien de suivi vit 24 h après la clôture (ou l'annulation) de la commande ; 72 h après sa création si elle n'est jamais clôturée. */
export const TRACKING_TTL_AFTER_CLOSE = DAY;
const OPEN_TTL = 3 * DAY;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type TrackingStage = "received" | "preparing" | "ready" | "done" | "cancelled";
const STAGE: Record<string, TrackingStage> = { PENDING: "received", IN_PROGRESS: "preparing", READY: "ready", DELIVERED: "done", CANCELLED: "cancelled" };

/** Suivi de commande sans compte : jeton imprimé sur le ticket (dérivé du secret serveur, stocké haché), statut en direct. */
@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService, @Inject(APP_ENV) private readonly env: Env) {}

  /** Jeton aléatoire pour le client (HMAC du secret serveur et de la commande) : stable, donc réimprimable, mais indevinable. */
  tokenFor(orderId: string): string {
    return createHmac("sha256", this.env.JWT_ACCESS_SECRET).update(`order-tracking:${orderId}`).digest("base64url");
  }

  /** Lien à imprimer sur le ticket (enregistre l'empreinte du jeton au premier appel). */
  async linkFor(acc: Account, orderId: string) {
    const tenantId = acc.tenantId!;
    const token = this.tokenFor(orderId);
    const slug = await this.prisma.asTenant(tenantId, async (tx) => {
      const o = await tx.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true, trackTokenHash: true } });
      if (!o) throw new NotFoundException("Commande introuvable");
      const hash = hashToken(token);
      if (o.trackTokenHash !== hash) await tx.order.update({ where: { id: o.id }, data: { trackTokenHash: hash } });
      return (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;
    });
    return { token, url: `${this.env.APP_URL}/r/${slug}/suivi/${token}` };
  }

  /** Commande désignée par le jeton : 404 si inconnu, 410 si le lien a expiré. */
  async byToken(token: string) {
    const order = await this.prisma.asPlatform((tx) => tx.order.findUnique({
      where: { trackTokenHash: hashToken(token) },
      include: {
        tenant: { select: { id: true, name: true, slug: true, phone: true, timezone: true, status: true } },
        table: { select: { label: true } },
        items: { where: { parentItemId: null, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, select: { name: true, quantity: true } },
        feedback: { select: { rating: true, comment: true, reply: true, repliedAt: true, hiddenAt: true, createdAt: true } },
      },
    }));
    if (!order || !["ACTIVE", "TRIAL"].includes(order.tenant.status)) throw new NotFoundException("Commande introuvable");
    const expiresAt = this.expiresAt(order);
    if (expiresAt.getTime() < Date.now()) throw new GoneException({ statusCode: 410, code: "TRACKING_EXPIRED", message: "Ce lien de suivi a expiré." });
    return { order, expiresAt };
  }

  expiresAt(o: { closedAt: Date | null; cancelledAt: Date | null; createdAt: Date }) {
    const end = o.closedAt ?? o.cancelledAt;
    return new Date(end ? end.getTime() + TRACKING_TTL_AFTER_CLOSE : o.createdAt.getTime() + OPEN_TTL);
  }

  async view(token: string) {
    const { order: o, expiresAt } = await this.byToken(token);
    return {
      number: o.number,
      type: o.type,
      typeLabel: ORDER_TYPES[o.type],
      stage: STAGE[o.status] ?? "received",
      table: o.table?.label ?? null,
      items: o.items,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      closedAt: o.closedAt,
      expiresAt,
      canReview: !!o.closedAt && !o.cancelledAt && !o.feedback,
      review: o.feedback ? { rating: o.feedback.rating, comment: o.feedback.comment, reply: o.feedback.hiddenAt ? null : o.feedback.reply, createdAt: o.feedback.createdAt } : null,
      restaurant: { name: o.tenant.name, slug: o.tenant.slug, phone: o.tenant.phone, timezone: o.tenant.timezone },
    };
  }

  /** Le client connecté rattache une commande (par le lien de son ticket) à son compte : elle apparaît dans « Mes avis ». */
  async claim(acc: Account, token: string) {
    const { order } = await this.byToken(token);
    if (order.tenantId !== acc.tenantId) throw new NotFoundException("Commande introuvable");
    if (order.customerId && order.customerId !== acc.id) throw new ConflictException("Cette commande est déjà rattachée à un autre compte");
    if (!order.customerId) await this.prisma.asTenant(acc.tenantId!, (tx) => tx.order.update({ where: { id: order.id }, data: { customerId: acc.id } }));
    return { orderId: order.id, number: order.number };
  }
}
