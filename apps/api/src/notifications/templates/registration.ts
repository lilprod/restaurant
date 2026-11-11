import type { TemplateDef } from "./types";

export interface RegistrationReceivedData { firstName: string; restaurantName: string }
export interface RegistrationApprovedData { firstName: string; restaurantName: string; loginUrl: string }
export interface RegistrationRejectedData { firstName: string; restaurantName: string; reason: string }

export const registrationReceived: TemplateDef<RegistrationReceivedData> = {
  category: "transactional",
  email: (d) => ({
    subject: "Votre demande d'inscription a bien été reçue",
    paragraphs: [
      `Bonjour ${d.firstName},`,
      `Nous avons bien reçu la demande d'inscription de « ${d.restaurantName} ». Notre équipe la vérifie et vous répond rapidement.`,
    ],
  }),
};

export const registrationApproved: TemplateDef<RegistrationApprovedData> = {
  category: "transactional",
  email: (d) => ({
    subject: "Votre restaurant est activé",
    paragraphs: [
      `Bonjour ${d.firstName},`,
      `Bonne nouvelle : « ${d.restaurantName} » est activé. Connectez-vous avec l'adresse et le mot de passe choisis à l'inscription.`,
    ],
    action: { label: "Se connecter", url: d.loginUrl },
  }),
};

export const registrationRejected: TemplateDef<RegistrationRejectedData> = {
  category: "transactional",
  email: (d) => ({
    subject: "Votre demande d'inscription n'a pas été retenue",
    paragraphs: [
      `Bonjour ${d.firstName},`,
      `Nous ne pouvons pas activer « ${d.restaurantName} » pour le moment.`,
      `Motif : ${d.reason}`,
      "Vous pouvez nous répondre ou déposer une nouvelle demande après correction.",
    ],
  }),
};
