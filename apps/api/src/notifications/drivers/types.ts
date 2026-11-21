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

/** Appareil destinataire d'un push (abonnement du navigateur). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  target: PushTarget;
  /** JSON de la charge utile (titre, texte, url, tag) ; chiffré par le pilote `webpush`. */
  payload: string;
  /** Durée de vie chez le service de push (secondes) : une alerte périmée n'est plus livrée. */
  ttl: number;
  urgency: "high";
}

export interface PushDriver {
  readonly name: string;
  /** Lève `PushGoneError` si l'abonnement n'existe plus, une autre erreur sinon (la file réessaie). */
  send(msg: PushMessage): Promise<void>;
}
