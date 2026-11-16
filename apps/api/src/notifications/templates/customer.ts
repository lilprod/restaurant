import { fitSms, type TemplateDef } from "./types";

export interface VerifyEmailData { firstName: string; code: string; minutes: number }
export interface OrderReadyData { name?: string; number: number }

/** Code de vérification d'email de l'espace client. Contient un secret : variables jamais conservées, pas de SMS. */
export const customerVerifyEmail: TemplateDef<VerifyEmailData> = {
  category: "transactional",
  sensitive: true,
  email: (d, b) => ({
    subject: `Votre code de vérification — ${b.name}`,
    paragraphs: [`Bonjour ${d.firstName},`, `Votre code de vérification : ${d.code}`, `Il est valable ${d.minutes} minutes.`],
    note: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
  }),
};

/** Commande à emporter prête à être retirée (SMS, sans lien). */
export const orderReady: TemplateDef<OrderReadyData> = {
  category: "reminder",
  event: "orderReady",
  sms: (d, b) => fitSms(`${b.name} : votre commande n°${d.number}${d.name ? ` (${d.name})` : ""} est prête, vous pouvez venir la retirer.`),
};
