/** Contrat des modèles de notification (versionnés dans le code, en français). */

export interface Brand {
  /** Nom affiché : nom du restaurant (ou de la plateforme pour les messages de la plateforme). */
  name: string;
  logoUrl?: string;
  /** Signature saisie dans les réglages du restaurant. */
  signature?: string;
  /** Coordonnées du pied de page. */
  contact: { phone?: string; email?: string; address?: string };
}

/** Contenu d'un email décrit sans HTML : le gabarit commun produit le texte et le HTML. */
export interface EmailParts {
  subject: string;
  /** Un paragraphe par entrée (texte brut ; le HTML est échappé automatiquement). */
  paragraphs: string[];
  /** Bouton d'action (lien affiché aussi en clair dans la version texte). */
  action?: { label: string; url: string };
  /** Petite mention en fin de message (ex. « Si vous n'êtes pas à l'origine de cette demande… »). */
  note?: string;
}

/**
 * Contenu d'une notification push (X5B). Affichée sur l'écran verrouillé : AUCUNE donnée sensible (ni montant, ni adresse, ni téléphone,
 * ni nom de client). L'application recharge le détail par l'API après le clic.
 */
export interface PushParts {
  title: string;
  body: string;
  /** Chemin interne DANS l'espace du restaurant (ex. `/mes-livraisons`) ; le service ajoute `/r/<slug>`. */
  path: string;
  /** Regroupe / remplace les notifications d'un même objet (ex. `order:<id>`). */
  tag: string;
}

export interface TemplateDef<D> {
  /** `transactional` : toujours envoyé. `reminder` : respecte les canaux actifs et les préférences par événement. */
  category: "transactional" | "reminder";
  /** Clé de préférence (réglages `notifications.events`) pour les modèles `reminder`. */
  event?: string;
  /** Contient un secret (lien de réinitialisation…) : les variables ne sont jamais enregistrées, le renvoi manuel est refusé. */
  sensitive?: boolean;
  email?: (data: D, brand: Brand) => EmailParts;
  /** Texte SMS (160 caractères maximum, tronqué sinon). Jamais de secret ni de code dans un SMS. */
  sms?: (data: D, brand: Brand) => string;
  /** Notification push web du personnel (X5B). */
  push?: (data: D, brand: Brand) => PushParts;
}

export const SMS_MAX_LENGTH = 160;

/** Ramène un SMS à 160 caractères au plus. */
export function fitSms(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= SMS_MAX_LENGTH ? t : `${t.slice(0, SMS_MAX_LENGTH - 1).trimEnd()}…`;
}
