import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { maskEmail, maskPhone, normalizePhone } from "@restaurant/utils";
import type { ListNotificationsQuery } from "@restaurant/validation";
import { APP_ENV, Env } from "../config/env";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { BullQueue, DeliveryJob, DeliveryQueue, SyncQueue } from "./delivery-queue";
import { LogEmailDriver, createEmailDriver } from "./drivers/email";
import { LogSmsDriver, createSmsDriver } from "./drivers/sms";
import type { EmailDriver, SmsDriver } from "./drivers/types";
import { TEMPLATES, renderEmail, type Brand, type TemplateDataMap, type TemplateName } from "./templates";
import { fitSms } from "./templates/types";

export type Channel = "EMAIL" | "SMS";

export interface SendInput<K extends TemplateName = TemplateName> {
  channel: Channel;
  /** Adresse email, ou numéro de téléphone (normalisé en E.164 ; 8 chiffres = numéro togolais). */
  to: string;
  template: K;
  data: TemplateDataMap[K];
  /** Restaurant concerné (marque, préférences, journal). Absent : message de la plateforme. */
  tenantId?: string | null;
  locale?: string;
  /** Clé d'idempotence : un second envoi avec la même clé est ignoré (« une seule fois »). */
  dedupeKey?: string;
}

export type SendResult =
  | { status: "queued"; id: string }
  | { status: "skipped"; reason: "channel_disabled" | "event_disabled" | "invalid_recipient" | "duplicate" | "error" };

const PLATFORM_BRAND: Brand = { name: "Gestion Restaurant", contact: {} };

/**
 * Service unique d'envoi (email, SMS) : rend le modèle, journalise (`NotificationLog`), met en file et rend la main.
 * Un envoi ne bloque ni ne fait échouer la requête métier : `send` ne lève jamais d'exception.
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly log = new Logger(NotificationsService.name);
  /** Pilotes actifs (variables d'environnement). Remplaçables dans les tests pour simuler une panne. */
  drivers: { email: EmailDriver; sms: SmsDriver };
  private readonly queue: DeliveryQueue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {
    this.drivers = { email: createEmailDriver(env), sms: createSmsDriver(env) };
    const process = this.processJob.bind(this);
    this.queue = env.NOTIFICATIONS_QUEUE === "bullmq"
      ? new BullQueue(env.REDIS_URL!, process, env.NOTIFICATIONS_RETRY_BASE_MS)
      : new SyncQueue(process, env.NOTIFICATIONS_RETRY_BASE_MS);
    this.log.log(`Notifications : email=${this.drivers.email.name}, sms=${this.drivers.sms.name}, file=${this.queue.mode}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }

  /** Emails capturés par le pilote `log` (tests / développement). */
  get outbox() {
    return this.drivers.email instanceof LogEmailDriver ? this.drivers.email.outbox : [];
  }
  /** SMS capturés par le pilote `log`. */
  get smsOutbox() {
    return this.drivers.sms instanceof LogSmsDriver ? this.drivers.sms.outbox : [];
  }
  /** Attend la fin des envois et reprises en cours (tests). */
  flush() {
    return this.queue.flush();
  }

  // ── Envoi ──

  async send<K extends TemplateName>(input: SendInput<K>, opts: { resendOfId?: string; ignorePreferences?: boolean } = {}): Promise<SendResult> {
    try {
      return await this.dispatch(input, opts);
    } catch (e) {
      this.log.error(`Envoi « ${input.template} » impossible : ${(e as Error).message}`);
      return { status: "skipped", reason: "error" };
    }
  }

  private async dispatch<K extends TemplateName>(input: SendInput<K>, opts: { resendOfId?: string; ignorePreferences?: boolean }): Promise<SendResult> {
    const def = TEMPLATES[input.template] as (typeof TEMPLATES)[TemplateName];
    const render = input.channel === "EMAIL" ? def.email : def.sms;
    if (!render) throw new Error(`Le modèle « ${input.template} » n'existe pas pour le canal ${input.channel}`);

    const to = input.channel === "EMAIL" ? input.to.trim().toLowerCase() : normalizePhone(input.to);
    if (!to || (input.channel === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))) return { status: "skipped", reason: "invalid_recipient" };

    const tenantId = input.tenantId ?? null;
    const ctx = tenantId ? await this.tenantContext(tenantId) : { brand: PLATFORM_BRAND, fromName: PLATFORM_BRAND.name, prefs: null };

    // Les messages transactionnels partent toujours ; les relances respectent les canaux et les préférences par événement.
    if (def.category === "reminder" && ctx.prefs && !opts.ignorePreferences) {
      if (!ctx.prefs.channels[input.channel === "EMAIL" ? "email" : "sms"]) return { status: "skipped", reason: "channel_disabled" };
      if (def.event && ctx.prefs.events[def.event] === false) return { status: "skipped", reason: "event_disabled" };
    }

    let job: DeliveryJob;
    let subject: string | null = null;
    if (input.channel === "EMAIL") {
      const c = renderEmail(def.email!(input.data as never, ctx.brand), ctx.brand);
      subject = c.subject;
      job = { logId: "", tenantId, channel: "EMAIL", to, from: this.env.MAIL_FROM, fromName: ctx.fromName, ...c };
    } else {
      job = { logId: "", tenantId, channel: "SMS", to, text: fitSms(def.sms!(input.data as never, ctx.brand)) };
    }

    let id: string;
    try {
      const row = await this.scoped(tenantId, (tx) =>
        tx.notificationLog.create({
          data: {
            tenantId, channel: input.channel, to, template: input.template, category: def.category, subject,
            locale: input.locale ?? "fr", dedupeKey: input.dedupeKey, resendOfId: opts.resendOfId,
            // Les modèles sensibles (lien de réinitialisation…) ne laissent aucune variable en base.
            ...(def.sensitive ? {} : { data: input.data as unknown as Prisma.InputJsonValue }),
          },
          select: { id: true },
        }),
      );
      id = row.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "skipped", reason: "duplicate" };
      throw e;
    }

    job.logId = id;
    try {
      await this.queue.add(job);
    } catch (e) {
      await this.update(tenantId, id, { status: "FAILED", error: `File d'envoi indisponible : ${(e as Error).message}`.slice(0, 300) });
    }
    return { status: "queued", id };
  }

  /** Une tentative d'envoi. `true` = terminé (envoyé ou abandonné après la dernière tentative), `false` = à réessayer. */
  private async processJob(job: DeliveryJob, attempt: number, maxAttempts: number): Promise<boolean> {
    try {
      if (job.channel === "EMAIL") await this.drivers.email.send({ to: job.to, from: job.from, fromName: job.fromName, subject: job.subject, text: job.text, html: job.html });
      else await this.drivers.sms.send({ to: job.to, text: job.text });
      await this.update(job.tenantId, job.logId, { status: "SENT", attempts: attempt, error: null, sentAt: new Date() });
      return true;
    } catch (e) {
      const final = attempt >= maxAttempts;
      const error = ((e as Error).message || "Erreur d'envoi").slice(0, 300);
      this.log.warn(`Envoi ${job.logId} : tentative ${attempt}/${maxAttempts} échouée (${error})`);
      await this.update(job.tenantId, job.logId, { status: final ? "FAILED" : "QUEUED", attempts: attempt, error });
      return final;
    }
  }

  // ── Journal ──

  async list(q: ListNotificationsQuery, scope: { tenantId: string } | "platform") {
    const where: Prisma.NotificationLogWhereInput = {
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.template ? { template: q.template } : {}),
    };
    if (scope !== "platform") where.tenantId = scope.tenantId;
    else if (q.tenantId) where.tenantId = q.tenantId === "none" ? null : q.tenantId;

    const run = async (tx: Tx) => {
      const [total, rows] = await Promise.all([
        tx.notificationLog.count({ where }),
        tx.notificationLog.findMany({
          where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          include: scope === "platform" ? { tenant: { select: { id: true, name: true, slug: true } } } : undefined,
        }),
      ]);
      return { total, rows };
    };
    const { total, rows } = await (scope === "platform" ? this.prisma.asPlatform(run) : this.prisma.asTenant(scope.tenantId, run));
    return { total, page: q.page, pageSize: q.pageSize, items: rows.map((r) => this.view(r)) };
  }

  /** Renvoi manuel : crée un nouvel envoi à partir des variables conservées. Impossible pour les messages confidentiels. */
  async resend(id: string, scope: { tenantId: string } | "platform") {
    const find = (tx: Tx) => tx.notificationLog.findFirst({ where: { id, ...(scope === "platform" ? {} : { tenantId: scope.tenantId }) } });
    const row = await (scope === "platform" ? this.prisma.asPlatform(find) : this.prisma.asTenant(scope.tenantId, find));
    if (!row) throw new NotFoundException("Notification introuvable");
    if (row.status === "QUEUED") throw new ConflictException("Ce message est encore en cours d'envoi");
    if (!row.data || !(row.template in TEMPLATES)) {
      throw new ConflictException("Ce message contient des informations confidentielles : il ne peut pas être renvoyé");
    }
    const r = await this.send(
      { channel: row.channel, to: row.to, template: row.template as TemplateName, data: row.data as never, tenantId: row.tenantId, locale: row.locale },
      { resendOfId: row.id, ignorePreferences: true },
    );
    if (r.status !== "queued") throw new ConflictException("Le renvoi n'a pas pu être lancé (destinataire invalide ou canal indisponible)");
    return { id: r.id };
  }

  private view(r: Prisma.NotificationLogGetPayload<{ include: { tenant: { select: { id: true; name: true; slug: true } } } }> | Prisma.NotificationLogGetPayload<object>) {
    const withTenant = r as { tenant?: { id: string; name: string; slug: string } | null };
    return {
      id: r.id,
      tenantId: r.tenantId,
      ...(withTenant.tenant !== undefined ? { tenant: withTenant.tenant } : {}),
      channel: r.channel,
      to: r.channel === "EMAIL" ? maskEmail(r.to) : maskPhone(r.to),
      template: r.template,
      category: r.category,
      subject: r.subject,
      status: r.status,
      error: r.error,
      attempts: r.attempts,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      resendOfId: r.resendOfId,
      canResend: r.status !== "QUEUED" && r.data !== null,
    };
  }

  // ── Internes ──

  private scoped<T>(tenantId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return tenantId ? this.prisma.asTenant(tenantId, fn) : this.prisma.asPlatform(fn);
  }

  private async update(tenantId: string | null, id: string, data: Prisma.NotificationLogUpdateManyMutationInput) {
    try {
      await this.scoped(tenantId, (tx) => tx.notificationLog.updateMany({ where: { id }, data }));
    } catch (e) {
      this.log.error(`Journal de notification ${id} non mis à jour : ${(e as Error).message}`);
    }
  }

  /** Marque (nom, logo, coordonnées, signature) et préférences d'un restaurant. */
  private async tenantContext(tenantId: string) {
    const s = (await this.settings.all(tenantId)) as unknown as {
      business: { phone?: string; email?: string; address?: { street?: string; postalCode?: string; city?: string; country?: string } };
      branding: { displayName: string; assets?: { logo?: string | null } };
      notifications: { channels: { email: boolean; sms: boolean }; senderName?: string; signature?: string; events: Record<string, boolean> };
    };
    const a = s.business.address ?? {};
    const address = [a.street, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
    const brand: Brand = {
      name: s.branding.displayName,
      logoUrl: s.branding.assets?.logo ?? undefined,
      signature: s.notifications.signature,
      contact: { phone: s.business.phone, email: s.business.email, address: address || undefined },
    };
    return { brand, fromName: s.notifications.senderName || s.branding.displayName, prefs: s.notifications };
  }
}
