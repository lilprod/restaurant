import type { TemplateDef } from "./types";

export interface DailyReportData {
  firstName: string;
  /** Ex. « lundi 16 novembre 2026 ». */
  dayLabel: string;
  revenue: string;
  orders: number;
  averageTicket: string;
  tips: string;
  /** Ex. « +12,5 % par rapport à la veille » (absent si la veille est sans vente). */
  vsPrevious?: string;
  /** Un moyen de paiement par ligne : « Espèces : 45 000 FCFA ». */
  methods: string[];
  /** Un plat par ligne : « 12 × Riz sauce arachide ». */
  topItems: string[];
  cancellations: string;
  reportUrl: string;
}

/** Rapport quotidien des ventes, envoyé le matin aux responsables (réglage `reports.dailyReport`). */
export const dailyReport: TemplateDef<DailyReportData> = {
  category: "reminder",
  event: "dailyReport",
  email: (d, b) => ({
    subject: `Ventes du ${d.dayLabel} — ${b.name}`,
    paragraphs: [
      `Bonjour ${d.firstName},`,
      `Voici le récapitulatif de ${b.name} pour le ${d.dayLabel}.`,
      `Chiffre d'affaires encaissé : ${d.revenue}${d.vsPrevious ? ` (${d.vsPrevious})` : ""}`,
      `Commandes : ${d.orders} · Ticket moyen : ${d.averageTicket} · Pourboires : ${d.tips}`,
      ...(d.methods.length ? ["Par moyen de paiement :", ...d.methods.map((m) => `• ${m}`)] : []),
      ...(d.topItems.length ? ["Plats les plus vendus :", ...d.topItems.map((m) => `• ${m}`)] : []),
      d.cancellations,
    ],
    action: { label: "Ouvrir les rapports", url: d.reportUrl },
    note: "Vous recevez ce message car le rapport quotidien est activé dans les réglages. L'administrateur peut le désactiver depuis la page Rapports.",
  }),
};
