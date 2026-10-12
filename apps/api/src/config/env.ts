import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET : 16 caractères minimum"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  /** Désactive le cron de licences (tests). */
  DISABLE_CRON: z.string().optional(),
  /** Clé de chiffrement des secrets 2FA (32 caractères min). Obligatoire en production. */
  DATA_ENCRYPTION_KEY: z.string().min(32).optional(),
  /** Dossier des fichiers envoyés (logos, favicons). */
  UPLOAD_DIR: z.string().default("uploads"),
  /** URL publique de l'API (pour construire les liens vers les fichiers). */
  PUBLIC_API_URL: z.string().url().optional(),
  /** URL de l'application web (liens de réinitialisation de mot de passe). */
  APP_URL: z.string().url().default("http://localhost:5173"),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.DATA_ENCRYPTION_KEY) {
    ctx.addIssue({ code: "custom", path: ["DATA_ENCRYPTION_KEY"], message: "obligatoire en production" });
  }
});

export type Env = z.infer<typeof envSchema> & { PUBLIC_API_URL: string };
export const APP_ENV = Symbol("APP_ENV");

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration invalide : ${msg}`);
  }
  const data = parsed.data;
  return { ...data, PUBLIC_API_URL: (data.PUBLIC_API_URL ?? `http://localhost:${data.PORT}`).replace(/\/$/, "") };
}
