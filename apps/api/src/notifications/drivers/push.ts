import { Logger } from "@nestjs/common";
import webpush from "web-push";
import type { Env } from "../../config/env";
import type { PushDriver, PushMessage } from "./types";

/** Le service de push répond 404 / 410 : l'abonnement n'existe plus (application désinstallée, autorisation retirée). Pas de reprise. */
export class PushGoneError extends Error {
  constructor(readonly statusCode: number) {
    super(`Abonnement expiré (${statusCode})`);
  }
}

/** Pilote par défaut (et tests) : garde les derniers envois en mémoire ; rien ne sort du serveur. */
export class LogPushDriver implements PushDriver {
  readonly name = "log";
  private readonly log = new Logger("Push");
  readonly outbox: PushMessage[] = [];

  async send(msg: PushMessage): Promise<void> {
    this.outbox.push(msg);
    if (this.outbox.length > 100) this.outbox.shift();
    // Le point d'accès est un secret de l'appareil : jamais journalisé en clair.
    this.log.log(`→ push ${new URL(msg.target.endpoint).hostname}${process.env.NODE_ENV === "production" ? "" : ` · ${msg.payload}`}`);
  }
}

/** Web Push (norme VAPID, bibliothèque `web-push`) : chiffre la charge utile pour l'appareil et l'envoie au service de push du navigateur. */
export class WebPushDriver implements PushDriver {
  readonly name = "webpush";

  constructor(env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY" | "VAPID_SUBJECT">) {
    webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  }

  async send(msg: PushMessage): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: msg.target.endpoint, keys: { p256dh: msg.target.p256dh, auth: msg.target.auth } },
        msg.payload,
        { TTL: msg.ttl, urgency: msg.urgency, timeout: 10_000 },
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new PushGoneError(status);
      throw new Error(status ? `Le service de push a répondu ${status}` : `Service de push injoignable : ${(e as Error).message}`.slice(0, 200));
    }
  }
}

export function createPushDriver(env: Env): PushDriver {
  const driver = env.PUSH_DRIVER ?? (env.VAPID_PUBLIC_KEY ? "webpush" : "log");
  return driver === "webpush" ? new WebPushDriver(env) : new LogPushDriver();
}
