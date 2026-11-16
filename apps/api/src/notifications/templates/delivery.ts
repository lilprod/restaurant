import { fitSms, type TemplateDef } from "./types";

export interface DeliveryOnTheWayData { number: number; driverName: string; driverPhone?: string | null }
export interface DeliveredData { number: number }

/** Commande partie en livraison (SMS, avec le nom et le numéro du livreur ; jamais de lien ni de code). */
export const deliveryOnTheWay: TemplateDef<DeliveryOnTheWayData> = {
  category: "reminder",
  event: "deliveryUpdates",
  sms: (d, b) => fitSms(`${b.name} : votre commande n°${d.number} est en route.${d.driverPhone ? ` Livreur : ${d.driverName}, ${d.driverPhone}.` : ` Livreur : ${d.driverName}.`}`),
};

/** Commande remise au client (SMS). */
export const deliveryDelivered: TemplateDef<DeliveredData> = {
  category: "reminder",
  event: "deliveryUpdates",
  sms: (d, b) => fitSms(`${b.name} : votre commande n°${d.number} a été livrée. Merci et bon appétit !`),
};
