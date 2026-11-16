import { z } from "zod";

/** Journal d'audit (restaurant ou plateforme) : filtres et pagination. `action` filtre par préfixe (ex. `reservation.`). */
export const auditLogQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  /** Auteur (compte du restaurant, ou membre de la plateforme). */
  userId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  /** Une date seule (AAAA-MM-JJ) inclut toute la journée. */
  to: z.preprocess((v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v), z.coerce.date().optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: "La date de début doit précéder la date de fin", path: ["from"] });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
