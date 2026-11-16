import { fitSms, type TemplateDef } from "./types";

export interface PlanningPublishedData {
  firstName: string;
  /** Ex. « du lundi 16 au dimanche 22 novembre ». */
  weekLabel: string;
  /** Un créneau par ligne : « lundi 16 novembre · 11:00–19:00 · Serveur ». */
  lines: string[];
}

/** Planning publié : envoyé à chaque personne concernée (ses créneaux seulement). */
export const planningPublished: TemplateDef<PlanningPublishedData> = {
  category: "reminder",
  event: "staffPlanning",
  email: (d, b) => ({
    subject: `Votre planning ${d.weekLabel} — ${b.name}`,
    paragraphs: [`Bonjour ${d.firstName},`, `Votre planning ${d.weekLabel} est publié :`, ...d.lines.map((l) => `• ${l}`)],
    note: "Un empêchement ? Prévenez rapidement un responsable.",
  }),
  sms: (d, b) => fitSms(`${b.name} : planning ${d.weekLabel} publié (${d.lines.length} créneau${d.lines.length > 1 ? "x" : ""}). Consultez l'application.`),
};
