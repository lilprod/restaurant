import type { TemplateDef } from "./types";

/** Modèles des notifications push de l'équipe (X5B) : titre court, texte sans montant, sans adresse ni téléphone ni nom de client. */

export interface PushTestData { name?: string }
export interface PushOrderData { orderId: string; number: number }
export interface PushDeliveryData extends PushOrderData { deliveryId: string }
export interface PushOrderReadyData extends PushOrderData { tableLabel?: string | null; whole: boolean }
export interface PushOrderItemsData extends PushOrderData { count: number }

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export const pushTest: TemplateDef<PushTestData> = {
  category: "transactional",
  push: (_d, b) => ({ title: "Notification de test", body: `${b.name} : les alertes fonctionnent sur cet appareil.`, path: "/impression", tag: "test" }),
};

/** Livreur : livraison attribuée. */
export const pushDeliveryAssigned: TemplateDef<PushDeliveryData> = {
  category: "reminder", event: "pushDelivery",
  push: (d) => ({ title: "Nouvelle livraison", body: `La commande n°${d.number} vous est attribuée.`, path: "/mes-livraisons", tag: `delivery:${d.deliveryId}` }),
};

/** Livreur : livraison retirée (réattribuée à un autre livreur). */
export const pushDeliveryUnassigned: TemplateDef<PushDeliveryData> = {
  category: "reminder", event: "pushDelivery",
  push: (d) => ({ title: "Livraison retirée", body: `La commande n°${d.number} a été confiée à un autre livreur.`, path: "/mes-livraisons", tag: `delivery:${d.deliveryId}` }),
};

/** Livreur : commande prête à récupérer. */
export const pushDeliveryReady: TemplateDef<PushDeliveryData> = {
  category: "reminder", event: "pushDelivery",
  push: (d) => ({ title: "Commande prête", body: `La commande n°${d.number} est prête à récupérer.`, path: "/mes-livraisons", tag: `delivery:${d.deliveryId}` }),
};

/** Serveur : plats ou commande prêts. */
export const pushOrderReady: TemplateDef<PushOrderReadyData> = {
  category: "reminder", event: "pushWaiter",
  push: (d) => ({
    title: d.whole ? "Commande prête" : "Plats prêts",
    body: `${d.tableLabel ? `${d.tableLabel} · ` : ""}commande n°${d.number}${d.whole ? " : tout est prêt." : " : des plats sont prêts à servir."}`,
    path: `/commandes/${d.orderId}`, tag: `order:${d.orderId}`,
  }),
};

/** Cuisine : nouvelle commande. */
export const pushKitchenNewOrder: TemplateDef<PushOrderItemsData> = {
  category: "reminder", event: "pushKitchen",
  push: (d) => ({ title: "Nouvelle commande", body: `Commande n°${d.number} · ${plural(d.count, "article", "articles")}.`, path: "/cuisine", tag: `kitchen:${d.orderId}` }),
};

/** Cuisine : articles ajoutés à une commande ouverte. */
export const pushKitchenItemsAdded: TemplateDef<PushOrderItemsData> = {
  category: "reminder", event: "pushKitchen",
  push: (d) => ({ title: "Articles ajoutés", body: `Commande n°${d.number} · ${plural(d.count, "article ajouté", "articles ajoutés")}.`, path: "/cuisine", tag: `kitchen:${d.orderId}` }),
};
