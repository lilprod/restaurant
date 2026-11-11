import { Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type { Env } from "../../config/env";
import type { EmailDriver, EmailMessage } from "./types";

/** Pilote par défaut : journalise et garde les derniers messages en mémoire (tests, développement). */
export class LogEmailDriver implements EmailDriver {
  readonly name = "log";
  private readonly log = new Logger("Mail");
  readonly outbox: EmailMessage[] = [];

  async send(msg: EmailMessage): Promise<void> {
    this.outbox.push(msg);
    if (this.outbox.length > 100) this.outbox.shift();
    this.log.log(`→ ${msg.to} · ${msg.subject}`);
    if (process.env.NODE_ENV !== "production") this.log.debug(msg.text);
  }
}

/** SMTP via nodemailer (Brevo, Mailjet, Gmail SMTP… : seule `SMTP_URL` change). */
export class SmtpEmailDriver implements EmailDriver {
  readonly name = "smtp";
  private readonly transport: Transporter;

  constructor(url: string) {
    this.transport = createTransport(url);
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: msg.fromName ? { name: msg.fromName, address: msg.from } : msg.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}

export function createEmailDriver(env: Env): EmailDriver {
  return env.MAIL_DRIVER === "smtp" ? new SmtpEmailDriver(env.SMTP_URL!) : new LogEmailDriver();
}
