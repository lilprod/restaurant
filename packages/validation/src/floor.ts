import { z } from "zod";

/** Plan de salle : salles, mise en page des tables, fusion, transfert de commande. */

const uuid = z.string().uuid();

export const tableShapeSchema = z.enum(["round", "square", "rect"]);
export const TABLE_SIZE = { min: 40, max: 400 } as const;
export const FLOOR_SIZE = { min: 400, max: 4000 } as const;

export const floorPlanInputSchema = z.object({
  name: z.string().trim().min(1, "Donnez un nom à la salle").max(40),
  width: z.number().int().min(FLOOR_SIZE.min).max(FLOOR_SIZE.max).default(1000),
  height: z.number().int().min(FLOOR_SIZE.min).max(FLOOR_SIZE.max).default(700),
});
export const floorPlanUpdateSchema = floorPlanInputSchema.partial();

/** Géométrie d'une table (unités du plan, origine en haut à gauche, rotation en degrés). */
const geometry = {
  posX: z.number().int().min(0).max(FLOOR_SIZE.max),
  posY: z.number().int().min(0).max(FLOOR_SIZE.max),
  width: z.number().int().min(TABLE_SIZE.min).max(TABLE_SIZE.max),
  height: z.number().int().min(TABLE_SIZE.min).max(TABLE_SIZE.max),
  shape: tableShapeSchema,
  rotation: z.number().int().min(0).max(359),
};
export const layoutEntrySchema = z.object({ id: uuid, ...geometry });
export const layoutSchema = z.object({ tables: z.array(layoutEntrySchema).min(1).max(300) });

/** Création d'une table depuis l'éditeur : salle et géométrie facultatives. */
export const tableCreateSchema = z.object({
  label: z.string().trim().min(1).max(20),
  capacity: z.number().int().min(1).max(50),
  isActive: z.boolean().default(true),
  floorPlanId: uuid.optional(),
  ...Object.fromEntries(Object.entries(geometry).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof geometry]: z.ZodOptional<(typeof geometry)[K]> },
});

export const mergeTablesSchema = z.object({ tableIds: z.array(uuid).min(2, "Choisissez au moins deux tables").max(6, "6 tables au plus") });
/** Action sans donnée : le corps est vide (documenté pour OpenAPI). */
export const splitTableSchema = z.object({}).optional();
export const moveOrderSchema = z.object({ tableId: uuid });

export type FloorPlanInput = z.infer<typeof floorPlanInputSchema>;
export type LayoutEntry = z.infer<typeof layoutEntrySchema>;
export type LayoutInput = z.infer<typeof layoutSchema>;
export type TableCreateInput = z.infer<typeof tableCreateSchema>;
export type TableShape = z.infer<typeof tableShapeSchema>;
