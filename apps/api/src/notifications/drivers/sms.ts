import { Logger } from "@nestjs/common";
import { maskPhone } from "@restaurant/utils";
import type { Env } from "../../config/env";
import type { SmsDriver, SmsMessage } from "./types";

type Fetch = typeof fetch;

/** Pilote par défaut : journalise (numéro masqué) et garde les derniers SMS en mémoire. */
export class LogSmsDriver implements SmsDriver {
  readonly name = "log";
  private readonly log = new Logger("Sms");
  readonly outbox: SmsMessage[] = [];

  async send(msg: SmsMessage): Promise<void> {
    this.outbox.push(msg);
    if (this.outbox.length > 100) this.outbox.shift();
    this.log.log(`→ ${maskPhone(msg.to)} · ${msg.text}`);
  }
}

async function assertOk(res: Response, what: string) {
  if (res.ok) return;
  const body = (await res.text().catch(() => "")).slice(0, 200);
  throw new Error(`${what} a répondu ${res.status}${body ? ` : ${body}` : ""}`);
}

/** Twilio (API REST Messages). Identifiants : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, expéditeur `SMS_FROM`. */
export class TwilioSmsDriver implements SmsDriver {
  readonly name = "twilio";
  constructor(private readonly sid: string, private readonly token: string, private readonly from: string, private readonly fetchImpl: Fetch = fetch) {}

  async send(msg: SmsMessage): Promise<void> {
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: msg.to, From: this.from, Body: msg.text }),
    });
    await assertOk(res, "Twilio");
  }
}

export interface HttpSmsConfig {
  url: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  /** Gabarit du corps avec `{{to}}`, `{{message}}`, `{{from}}` ; par défaut `{ to, from, message }`. */
  body?: string;
  contentType: "json" | "form";
  from?: string;
}

/**
 * Agrégateur SMS générique : une simple requête HTTP configurable par variables d'environnement.
 * Tout code 2xx est un succès. Les valeurs insérées dans le gabarit sont échappées selon le format.
 */
export class HttpSmsDriver implements SmsDriver {
  readonly name = "http";
  constructor(private readonly cfg: HttpSmsConfig, private readonly fetchImpl: Fetch = fetch) {}

  /** Construit la requête (exposé pour les tests). */
  buildRequest(msg: SmsMessage): { url: string; init: RequestInit } {
    const values = { to: msg.to, message: msg.text, from: this.cfg.from ?? "" };
    const esc = (v: string) => (this.cfg.contentType === "json" ? JSON.stringify(v).slice(1, -1) : encodeURIComponent(v));
    const fill = (tpl: string) => tpl.replace(/\{\{(to|message|from)\}\}/g, (_, k: keyof typeof values) => esc(values[k]));

    const headers = { ...this.cfg.headers };
    const defaultBody = this.cfg.contentType === "json" ? '{"to":"{{to}}","from":"{{from}}","message":"{{message}}"}' : "to={{to}}&from={{from}}&message={{message}}";
    const body = fill(this.cfg.body ?? defaultBody);
    if (this.cfg.method === "GET") {
      const sep = this.cfg.url.includes("?") ? "&" : "?";
      const query = this.cfg.contentType === "form" ? body : new URLSearchParams(JSON.parse(body) as Record<string, string>).toString();
      return { url: `${this.cfg.url}${sep}${query}`, init: { method: "GET", headers } };
    }
    headers["Content-Type"] ??= this.cfg.contentType === "json" ? "application/json" : "application/x-www-form-urlencoded";
    return { url: this.cfg.url, init: { method: "POST", headers, body } };
  }

  async send(msg: SmsMessage): Promise<void> {
    const { url, init } = this.buildRequest(msg);
    await assertOk(await this.fetchImpl(url, init), "Le service SMS");
  }
}

export function createSmsDriver(env: Env): SmsDriver {
  if (env.SMS_DRIVER === "twilio") return new TwilioSmsDriver(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.SMS_FROM!);
  if (env.SMS_DRIVER === "http") {
    return new HttpSmsDriver({
      url: env.SMS_HTTP_URL!,
      method: env.SMS_HTTP_METHOD,
      headers: env.SMS_HTTP_HEADERS ? (JSON.parse(env.SMS_HTTP_HEADERS) as Record<string, string>) : {},
      body: env.SMS_HTTP_BODY,
      contentType: env.SMS_HTTP_CONTENT_TYPE,
      from: env.SMS_FROM,
    });
  }
  return new LogSmsDriver();
}
