/** Pilotes d'envoi interchangeables (choisis par variables d'environnement, voir `drivers/index.ts`). */

export interface EmailMessage {
  to: string;
  from: string;
  /** Nom d'expéditeur affiché (nom du restaurant ou réglage `senderName`). */
  fromName?: string;
  subject: string;
  text: string;
  html: string;
}

export interface SmsMessage {
  /** Numéro E.164. */
  to: string;
  text: string;
}

export interface EmailDriver {
  readonly name: string;
  /** Lève une erreur si l'envoi échoue (la file réessaie). */
  send(msg: EmailMessage): Promise<void>;
}

export interface SmsDriver {
  readonly name: string;
  send(msg: SmsMessage): Promise<void>;
}
