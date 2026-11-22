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
import { PushGoneError, LogPushDriver, createPushDriver } from "./drivers/push";
import type { EmailDriver, PushDriver, SmsDriver } from "./drivers/types";
import { TEMPLATES, renderEmail, type Brand, type PushTemplateName, type TemplateDataMap, type TemplateName } from "./templates";
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

/** Durée de vie d'une alerte chez le service de push (secondes) : au-delà, elle n'est plus livrée. */
export const PUSH_TTL_SECONDS = 300;

/** Qui reçoit un push : des comptes précis ou tous les comptes d'un rôle (comptes actifs du restaurant uniquement), éventuellement un seul appareil. */
export interface PushAudience {
  userIds?: string[];
  role?: "KITCHEN";
  /** Un seul appareil (bouton « Tester »). */
  endpoint?: string;
}

export interface PushInput<K extends PushTemplateName = PushTemplateName> {
  template: K;
  data: TemplateDataMap[K];
  tenantId: string;
  audience: PushAudience;
  /** Compte qui a déclenché l'événement : il n'est pas alerté de sa propre action. */
  excludeUserId?: string;
  /** Une seule fois par événement et par appareil (la clé de l'appareil est ajoutée). */
  dedupeKey?: string;
}

export type PushResult = { queued: number; skipped?: "disabled" | "channel_disabled" | "event_disabled" | "no_device" | "error" };

const PLATFORM_BRAND: Brand = { name: "Gestion Restaurant", contact: {} };

/**
 * Service unique d'envoi (email, SMS) : rend le modèle, journalise (`NotificationLog`), met en file et rend la main.
 * Un envoi ne bloque ni ne fait échouer la requête métier : `send` ne lève jamais d'exception.
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly log = new Logger(NotificationsService.name);
  /** Pilotes actifs (variables d'environnement). Remplaçables dans les tests pour simuler une panne. */
  drivers: { email: EmailDriver; sms: SmsDriver; push: PushDriver };
  /** Envois push en cours (non bloquants pour la requête métier) : `flush()` les attend. */
  private readonly inflight = new Set<Promise<unknown>>();
  /** File d'attente des envois push (un à la fois). */
  private pushChain: Promise<void> = Promise.resolve();
  private readonly queue: DeliveryQueue;

  /** Instances vivantes (une par application) : `settleAll()` permet aux tests d'attendre les envois en cours avant de vider la base. */
  private static readonly live = new Set<NotificationsService>();
  static async settleAll() {
    for (const svc of NotificationsService.live) while (svc.inflight.size) await Promise.allSettled([...svc.inflight]);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TenantSettingsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {
    this.drivers = { email: createEmailDriver(env), sms: createSmsDriver(env), push: createPushDriver(env) };
    const process = this.processJob.bind(this);
    this.queue = env.NOTIFICATIONS_QUEUE === "bullmq"
      ? new BullQueue(env.REDIS_URL!, process, env.NOTIFICATIONS_RETRY_BASE_MS)
      : new SyncQueue(process, env.NOTIFICATIONS_RETRY_BASE_MS);
    NotificationsService.live.add(this);
    this.log.log(`Notifications : email=${this.drivers.email.name}, sms=${this.drivers.sms.name}, push=${this.pushEnabled ? this.drivers.push.name : "désactivé"}, file=${this.queue.mode}`);
  }

  async onModuleDestroy() {
    // Arrêt propre : on attend les envois push lancés sans attente par les modules métier avant de fermer la file,
    // sinon ils continuent d'interroger la base après la fermeture (notifications perdues, requêtes orphelines).
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
    await this.queue.close();
    NotificationsService.live.delete(this);
  }

  /** Emails capturés par le pilote `log` (tests / développement). */
  get outbox() {
    return this.drivers.email instanceof LogEmailDriver ? this.drivers.email.outbox : [];
  }
  /** SMS capturés par le pilote `log`. */
  get smsOutbox() {
    return this.drivers.sms instanceof LogSmsDriver ? this.drivers.sms.outbox : [];
  }
  /** Push capturés par le pilote `log` (tests / développement). */
  get pushOutbox() {
    return this.drivers.push instanceof LogPushDriver ? this.drivers.push.outbox : [];
  }
  /** Push disponible : clés VAPID configurées (sinon aucun abonnement possible, aucun envoi). */
  get pushEnabled() {
    return !!this.env.VAPID_PUBLIC_KEY;
  }
  /** Attend la fin des envois et reprises en cours (tests). */
  async flush() {
    while (this.inflight.size) await Promise.all([...this.inflight]);
    await this.queue.flush();
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
      if (job.channel === "PUSH") {
        if (await this.sendPushJob(job, attempt)) return true;
      } else if (job.channel === "EMAIL") await this.drivers.email.send({ to: job.to, from: job.from, fromName: job.fromName, subject: job.subject, text: job.text, html: job.html });
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

  // ── Push web (X5B) ──

  /**
   * Envoie une notification push aux appareils abonnés du personnel : mêmes règles que `send` (préférences du restaurant, journal,
   * reprises, `dedupeKey`), mais jamais attendu par la requête métier. Ne lève jamais d'exception.
   */
  sendPush<K extends PushTemplateName>(input: PushInput<K>, opts: { ignorePreferences?: boolean } = {}): Promise<PushResult> {
    // Envois en arrière-plan traités un par un : ils n'occupent jamais plus d'une connexion à la base, pour ne pas priver
    // les requêtes métier (une rafale de commandes déclenche autant d'envois, chacun dans sa propre transaction).
    const p: Promise<PushResult> = this.pushChain.then(() => this.dispatchPush(input, opts)).catch((e: Error) => {
      this.log.error(`Push « ${input.template} » impossible : ${e.message}`);
      return { queued: 0, skipped: "error" as const };
    });
    this.pushChain = p.then(() => undefined);
    const tracked = p.finally(() => this.inflight.delete(tracked));
    this.inflight.add(tracked);
    return p;
  }

  private async dispatchPush<K extends PushTemplateName>(input: PushInput<K>, opts: { ignorePreferences?: boolean }): Promise<PushResult> {
    if (!this.pushEnabled) return { queued: 0, skipped: "disabled" };
    const def = TEMPLATES[input.template] as (typeof TEMPLATES)[TemplateName];
    if (!def.push) throw new Error(`Le modèle « ${input.template} » n'a pas de contenu push`);
    const { tenantId, audience } = input;
    const ctx = await this.tenantContext(tenantId);
    if (def.category === "reminder" && !opts.ignorePreferences) {
      if (ctx.prefs.channels.push === false) return { queued: 0, skipped: "channel_disabled" };
      if (def.event && ctx.prefs.events[def.event] === false) return { queued: 0, skipped: "event_disabled" };
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (!tenant) throw new Error("Restaurant introuvable");
    const parts = def.push(input.data as never, ctx.brand);
    const payload = { title: parts.title, body: parts.body, url: `/r/${tenant.slug}${parts.path}`, tag: parts.tag, renotify: true };

    const subs = await this.prisma.asTenant(tenantId, (tx) => tx.pushSubscription.findMany({
      where: {
        tenantId,
        user: { isActive: true, ...(audience.role ? { role: audience.role } : {}) },
        AND: [
          audience.userIds ? { userId: { in: audience.userIds } } : {},
          input.excludeUserId ? { userId: { not: input.excludeUserId } } : {},
          audience.endpoint ? { endpoint: audience.endpoint } : {},
        ],
      },
      select: { id: true, userId: true },
    }));
    if (!subs.length) return { queued: 0, skipped: "no_device" };

    const json = JSON.stringify(payload);
    let queued = 0;
    for (const sub of subs) {
      let id: string;
      try {
        const row = await this.prisma.asTenant(tenantId, (tx) => tx.notificationLog.create({
          data: {
            tenantId, channel: "PUSH", to: sub.id, template: input.template, category: def.category, subject: payload.title, locale: "fr",
            dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${sub.id}` : undefined,
            // Charge utile exacte (sans donnée sensible par construction) : consultable dans le journal.
            data: { ...payload, userId: sub.userId },
          },
          select: { id: true },
        }));
        id = row.id;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;   // déjà envoyé pour cet événement
        throw e;
      }
      const job: DeliveryJob = { logId: id, tenantId, channel: "PUSH", subscriptionId: sub.id, payload: json };
      try {
        await this.queue.add(job);
      } catch (e) {
        await this.update(tenantId, id, { status: "FAILED", error: `File d'envoi indisponible : ${(e as Error).message}`.slice(0, 300) });
      }
      queued++;
    }
    return { queued };
  }

  /**
   * Une tentative d'envoi push. `true` = abonnement expiré (404 / 410 du service de push) : appareil supprimé, journal en échec, pas de reprise.
   * Toute autre erreur est levée : la file réessaie (5 tentatives, délai doublé).
   */
  private async sendPushJob(job: Extract<DeliveryJob, { channel: "PUSH" }>, attempt: number): Promise<boolean> {
    const sub = await this.prisma.asTenant(job.tenantId, (tx) => tx.pushSubscription.findFirst({ where: { id: job.subscriptionId, tenantId: job.tenantId } }));
    if (!sub) {
      await this.update(job.tenantId, job.logId, { status: "FAILED", attempts: attempt, error: "Appareil désabonné avant l'envoi" });
      return true;
    }
    try {
      await this.drivers.push.send({ target: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload: job.payload, ttl: PUSH_TTL_SECONDS, urgency: "high" });
      return false;
    } catch (e) {
      if (!(e instanceof PushGoneError)) throw e;
      await this.prisma.asTenant(job.tenantId, (tx) => tx.pushSubscription.deleteMany({ where: { id: sub.id } }));
      await this.update(job.tenantId, job.logId, { status: "FAILED", attempts: attempt, error: `${e.message} : appareil supprimé` });
      return true;
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
    if (row.channel === "PUSH") throw new ConflictException("Une notification push ne peut pas être renvoyée : elle est périmée au bout de quelques minutes");
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
      to: r.channel === "EMAIL" ? maskEmail(r.to) : r.channel === "PUSH" ? `Appareil ••${r.to.slice(-4)}` : maskPhone(r.to),
      template: r.template,
      category: r.category,
      subject: r.subject,
      status: r.status,
      error: r.error,
      attempts: r.attempts,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
      resendOfId: r.resendOfId,
      canResend: r.channel !== "PUSH" && r.status !== "QUEUED" && r.data !== null,
      /** Push : titre, texte, adresse interne et regroupement tels qu'envoyés à l'appareil (aucune donnée sensible). */
      ...(r.channel === "PUSH" ? { payload: pushPayloadOf(r.data) } : {}),
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
      notifications: { channels: { email: boolean; sms: boolean; push?: boolean }; senderName?: string; signature?: string; events: Record<string, boolean> };
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

function pushPayloadOf(data: Prisma.JsonValue | null) {
  const d = (data ?? {}) as { title?: string; body?: string; url?: string; tag?: string };
  return { title: d.title ?? "", body: d.body ?? "", url: d.url ?? "", tag: d.tag ?? "" };
}
