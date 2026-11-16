import { z } from "zod";

/** X2 — Livraison : zones par quartier, adresse de livraison, actions du livreur, rapprochement. */

const uuid = z.string().uuid();
const names = (min: number, max: number, count: number) =>
  z.array(z.string().trim().min(min).max(max)).max(count)
    // Doublons ignorés sans tenir compte de la casse (« Tokoin » = « tokoin »).
    .transform((l) => l.filter((x, i) => l.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i));

export const deliveryZoneInputSchema = z.object({
  name: z.string().trim().min(2, "Donnez un nom à la zone").max(60),
  /** Quartiers desservis (pas de codes postaux à Lomé). */
  neighborhoods: names(2, 60, 80).refine((l) => l.length >= 1, "Ajoutez au moins un quartier"),
  /** Repères connus de la zone (suggestions à la prise de commande). */
  landmarks: names(2, 80, 80).default([]),
  fee: z.number().int().min(0).max(100_000),
  minOrder: z.number().int().min(0).max(1_000_000).default(0),
  /** Délai estimé de livraison, en minutes (de la commande à la remise au client). */
  etaMinutes: z.number().int().min(5).max(240).default(45),
  isActive: z.boolean().default(true),
});
export const deliveryZoneUpdateSchema = deliveryZoneInputSchema.partial().refine((p) => Object.keys(p).length > 0, "Aucune modification");

/** Livraison d'une commande : zone, quartier de la zone, adresse et point de repère obligatoires. */
export const orderDeliveryInputSchema = z.object({
  zoneId: uuid,
  neighborhood: z.string().trim().min(2, "Choisissez le quartier").max(60),
  address: z.string().trim().min(3, "Indiquez l'adresse").max(200),
  landmark: z.string().trim().min(3, "Indiquez un point de repère").max(120),
});

export const assignDeliverySchema = z.object({ driverId: uuid });
export const failDeliverySchema = z.object({ reason: z.string().trim().min(3, "Indiquez le motif").max(200) });
export const deliveryCollectMethodSchema = z.enum(["CASH", "FLOOZ", "TMONEY"]);
/** Remise au client. Reste à payer > 0 : moyen d'encaissement obligatoire (paiement à la livraison). */
export const completeDeliverySchema = z
  .object({
    method: deliveryCollectMethodSchema.optional(),
    reference: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
    /** Espèces : somme remise par le client (pour la monnaie). */
    tendered: z.number().int().min(0).max(100_000_000).optional(),
  })
  .refine((p) => !p.method || !["FLOOZ", "TMONEY"].includes(p.method) || !!p.reference, { message: "La référence de transaction est obligatoire", path: ["reference"] });
export const settleDeliveriesSchema = z.object({ driverId: uuid });
export const listDeliveriesQuerySchema = z.object({
  /** Jour (AAAA-MM-JJ, fuseau du restaurant) pour les livraisons terminées ; par défaut aujourd'hui. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type DeliveryZoneInput = z.infer<typeof deliveryZoneInputSchema>;
export type DeliveryZoneUpdate = z.infer<typeof deliveryZoneUpdateSchema>;
export type OrderDeliveryInput = z.infer<typeof orderDeliveryInputSchema>;
export type CompleteDeliveryInput = z.infer<typeof completeDeliverySchema>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
