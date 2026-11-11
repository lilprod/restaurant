import { Injectable } from "@nestjs/common";
import { NotificationsService } from "../notifications/notifications.service";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * @deprecated Adaptateur de compatibilité : utilisez `NotificationsService` avec un modèle (src/notifications/templates).
 * Envoie un message libre par le nouveau service (pilote, file et journal inclus).
 */
@Injectable()
export class MailService {
  constructor(private readonly notifications: NotificationsService) {}

  /** Emails capturés par le pilote `log` (tests). */
  get outbox() {
    return this.notifications.outbox;
  }

  async send(msg: MailMessage): Promise<void> {
    await this.notifications.send({ channel: "EMAIL", to: msg.to, template: "generic.message", data: { subject: msg.subject, text: msg.text } });
  }
}
