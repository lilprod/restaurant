import type { TemplateDef } from "./types";

export interface PasswordResetData { firstName: string; resetUrl: string }

/** Réinitialisation de mot de passe : lien uniquement par email (jamais par SMS). Variables non conservées. */
export const passwordReset: TemplateDef<PasswordResetData> = {
  category: "transactional",
  sensitive: true,
  email: (d) => ({
    subject: "Réinitialisation de votre mot de passe",
    paragraphs: [`Bonjour ${d.firstName},`, "Pour choisir un nouveau mot de passe, utilisez le lien ci-dessous (valable 1 heure)."],
    action: { label: "Choisir un nouveau mot de passe", url: d.resetUrl },
    note: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
  }),
};
