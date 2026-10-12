import { Injectable, Logger } from "@nestjs/common";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Envoi d'emails. Pour l'instant : journalisation (+ boîte d'envoi en mémoire pour les tests).
 * Un fournisseur (Brevo, SMTP…) se branchera ici sans toucher aux appelants.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");
  readonly outbox: MailMessage[] = [];

  async send(msg: MailMessage): Promise<void> {
    this.outbox.push(msg);
    if (this.outbox.length > 100) this.outbox.shift();
    this.log.log(`→ ${msg.to} · ${msg.subject}`);
    if (process.env.NODE_ENV !== "production") this.log.debug(msg.text);
  }
}
