import { fitSms, type TemplateDef } from "./types";

export type LicenseTier = "J7" | "J1" | "J0";
export interface LicenseReminderData {
  firstName: string;
  tier: LicenseTier;
  /** Date d'échéance, déjà formatée (ex. « 18 novembre 2026 »). */
  endDate: string;
  planName: string;
  /** Lien vers la page Licence du restaurant. */
  licenseUrl: string;
}

const when: Record<LicenseTier, string> = {
  J7: "expire dans 7 jours",
  J1: "expire demain",
  J0: "expire aujourd'hui",
};

/** Relance de licence aux administrateurs du restaurant (J-7, J-1, jour d'expiration). */
export const licenseReminder: TemplateDef<LicenseReminderData> = {
  category: "reminder",
  event: "licenseReminders",
  email: (d, b) => ({
    subject: `Votre licence ${b.name} ${when[d.tier]}`,
    paragraphs: [
      `Bonjour ${d.firstName},`,
      `Votre licence (${d.planName}) ${when[d.tier]} : échéance le ${d.endDate}.`,
      d.tier === "J0"
        ? "L'accès reste ouvert pendant la période de grâce ; renouvelez dès maintenant pour éviter la suspension du restaurant."
        : "Renouvelez à temps pour que le service ne soit pas interrompu.",
    ],
    action: { label: "Voir comment payer", url: d.licenseUrl },
  }),
  sms: (d, b) => fitSms(`${b.name} : votre licence ${when[d.tier]} (échéance ${d.endDate}). Renouvelez-la depuis l'espace Licence.`),
};
