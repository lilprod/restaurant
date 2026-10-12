import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RecordPaymentInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../../prisma/prisma.service";
import { PlatformSettingsService } from "../../settings/platform-settings.service";
import { PlatformAuditService } from "../audit/platform-audit.service";
import { computeRenewal, evaluateLicense, receiptNumber, tenantStatusFor } from "../licensing/licensing";

/**
 * Borne haute d'un filtre de dates. Une date seule (« 2026-10-12 », lue à minuit UTC) inclut toute la journée ;
 * une date-heure précise est prise telle quelle.
 */
export function upperBound(to: Date): { lt: Date } | { lte: Date } {
  const midnight = to.getUTCHours() === 0 && to.getUTCMinutes() === 0 && to.getUTCSeconds() === 0 && to.getUTCMilliseconds() === 0;
  return midnight ? { lt: new Date(to.getTime() + 86_400_000) } : { lte: to };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /**
   * Enregistre un paiement de licence saisi manuellement (espèces, carte, Flooz, TMoney) et
   * prolonge la licence du restaurant. Tout se fait dans une seule transaction.
   */
  async record(input: RecordPaymentInput, actorId: string) {
    const now = new Date();
    const paidAt = input.paidAt ?? now;
    if (paidAt.getTime() > now.getTime() + 24 * 3_600_000) throw new BadRequestException("La date de paiement ne peut pas être dans le futur");

    return this.prisma.asPlatform(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
      if (!tenant) throw new NotFoundException("Restaurant introuvable");
      if (tenant.status === "CANCELLED") throw new ConflictException("Ce restaurant est résilié");

      const current = await tx.subscription.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" } });
      const planId = input.planId ?? current?.planId;
      if (!planId) throw new BadRequestException("Aucun plan associé : précisez planId");
      const plan = await tx.plan.findUnique({ where: { id: planId } });
      if (!plan || (input.planId && !plan.isActive)) throw new NotFoundException("Plan introuvable ou désactivé");

      const unit = input.billingCycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
      const amount = input.amount ?? unit * input.periods;
      if (amount <= 0) throw new BadRequestException("Montant nul : précisez le montant encaissé");

      // Licence échue/résiliée → on repart sur une nouvelle ligne (réactivation) ; sinon on prolonge.
      // Le cycle de la licence est celui du dernier paiement : il décrit la période en cours (mensuelle ou annuelle).
      // L'historique des cycles reste dans chaque paiement.
      const reactivation = !current || current.status === "EXPIRED" || current.status === "CANCELLED";
      const { periodStart, periodEnd } = computeRenewal({
        now,
        currentPeriodEnd: reactivation ? null : current.currentPeriodEnd,
        billingCycle: input.billingCycle,
        periods: input.periods,
      });

      const subscription = reactivation
        ? await tx.subscription.create({
            data: { tenantId: tenant.id, planId, status: "ACTIVE", billingCycle: input.billingCycle, startsAt: periodStart, currentPeriodEnd: periodEnd },
          })
        : await tx.subscription.update({
            where: { id: current.id },
            data: { planId, status: "ACTIVE", billingCycle: input.billingCycle, currentPeriodEnd: periodEnd, graceEndsAt: null, reminderSentAt: null },
          });

      const year = now.getUTCFullYear();
      const counter = await tx.receiptCounter.upsert({
        where: { year }, create: { year, last: 1 }, update: { last: { increment: 1 } },
      });

      const payment = await tx.subscriptionPayment.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: subscription.id,
          method: input.method,
          amount,
          currency: tenant.currency,
          billingCycle: input.billingCycle,
          periodStart,
          periodEnd,
          paidAt,
          reference: input.reference,
          notes: input.notes,
          receiptNumber: receiptNumber(year, counter.last),
          recordedById: actorId,
        },
      });

      // Une suspension manuelle (licence encore valide) n'est pas levée par un paiement.
      const manuallySuspended = tenant.status === "SUSPENDED" && !reactivation;
      if (!manuallySuspended) {
        await tx.tenant.update({ where: { id: tenant.id }, data: { status: "ACTIVE" } });
      }
      await this.audit.log(
        { actorId, action: "payment.record", entity: "SubscriptionPayment", entityId: payment.id, metadata: { tenantId: tenant.id, amount, method: input.method, receipt: payment.receiptNumber } },
        tx,
      );
      return { ...payment, subscription, tenantStatus: manuallySuspended ? "SUSPENDED" : "ACTIVE" };
    });
  }

  /**
   * Annule un paiement saisi par erreur. Seul le dernier paiement d'une licence peut être annulé :
   * la période est alors restituée telle qu'avant le paiement.
   */
  async void(id: string, reason: string, actorId: string) {
    const graceDays = await this.settings.graceDays();
    return this.prisma.asPlatform(async (tx) => {
      const payment = await tx.subscriptionPayment.findUnique({ where: { id }, include: { subscription: true } });
      if (!payment) throw new NotFoundException("Paiement introuvable");
      if (payment.status === "VOIDED") throw new ConflictException("Ce paiement est déjà annulé");

      const latest = await tx.subscriptionPayment.findFirst({
        where: { subscriptionId: payment.subscriptionId, status: "RECORDED" },
        orderBy: { periodEnd: "desc" },
      });
      if (latest?.id !== payment.id) throw new ConflictException("Seul le dernier paiement de cette licence peut être annulé");

      const sub = payment.subscription;
      const now = new Date();
      const remaining = await tx.subscriptionPayment.count({ where: { subscriptionId: sub.id, status: "RECORDED", NOT: { id } } });

      // Dernier paiement de cette ligne : on revient à l'essai d'origine, ou on annule la licence
      // si elle n'existait que grâce à ce paiement. Sinon on restitue la période précédente.
      const backToTrial = remaining === 0 && sub.trialEndsAt !== null;
      const cancelled = remaining === 0 && !backToTrial;
      const restoredEnd = backToTrial ? sub.trialEndsAt! : payment.periodStart;

      let subUpdate: Prisma.SubscriptionUpdateInput;
      let tenantStatus: "SUSPENDED" | "TRIAL" | "ACTIVE" | "CANCELLED" | "PENDING";
      if (cancelled) {
        subUpdate = { status: "CANCELLED", cancelledAt: now };
        tenantStatus = "SUSPENDED";
      } else {
        const ev = evaluateLicense(
          { status: backToTrial ? "TRIALING" : "ACTIVE", currentPeriodEnd: restoredEnd, graceEndsAt: null }, now, graceDays,
        );
        subUpdate = { status: ev.status, currentPeriodEnd: restoredEnd, graceEndsAt: ev.graceEndsAt };
        tenantStatus = tenantStatusFor(ev.status, backToTrial ? "TRIAL" : "ACTIVE");
      }
      await tx.subscription.update({ where: { id: sub.id }, data: subUpdate });
      await tx.tenant.updateMany({ where: { id: payment.tenantId, NOT: { status: "CANCELLED" } }, data: { status: tenantStatus } });

      const voided = await tx.subscriptionPayment.update({
        where: { id }, data: { status: "VOIDED", voidedAt: now, voidReason: reason },
      });
      await this.audit.log({ actorId, action: "payment.void", entity: "SubscriptionPayment", entityId: id, metadata: { reason, receipt: payment.receiptNumber } }, tx);
      return voided;
    });
  }

  async list(q: { tenantId?: string; method?: string; from?: Date; to?: Date; page: number; pageSize: number }) {
    const where: Prisma.SubscriptionPaymentWhereInput = {
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      ...(q.method ? { method: q.method as never } : {}),
      ...(q.from || q.to ? { paidAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? upperBound(q.to) : {}) } } : {}),
    };
    const [total, items, sum] = await Promise.all([
      this.prisma.subscriptionPayment.count({ where }),
      this.prisma.subscriptionPayment.findMany({
        where, orderBy: { paidAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { tenant: { select: { id: true, name: true, slug: true } } },
      }),
      this.prisma.subscriptionPayment.aggregate({ where: { ...where, status: "RECORDED" }, _sum: { amount: true } }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, totalAmount: sum._sum.amount ?? 0, items };
  }

  /** Données du reçu (la génération PDF viendra avec le module rapports). */
  async receipt(id: string) {
    const p = await this.prisma.subscriptionPayment.findUnique({
      where: { id },
      include: {
        tenant: { select: { name: true, slug: true, email: true } },
        subscription: { include: { plan: { select: { name: true } } } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!p) throw new NotFoundException("Paiement introuvable");
    return p;
  }
}

export type { Tx };
