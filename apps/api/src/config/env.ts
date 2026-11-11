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
  // ── Notifications (X1) ──
  /** Pilote email : `log` (défaut, journalise seulement) ou `smtp`. */
  MAIL_DRIVER: z.enum(["log", "smtp"]).default("log"),
  /** URL SMTP, ex. `smtp://utilisateur:motdepasse@smtp-relay.brevo.com:587` (smtps:// pour TLS direct). */
  SMTP_URL: z.string().optional(),
  /** Adresse d'expédition des emails. */
  MAIL_FROM: z.string().regex(/^[^\s@]+@[^\s@]+$/, "adresse email attendue").default("no-reply@localhost"),
  /** Pilote SMS : `log` (défaut), `twilio` ou `http` (agrégateur générique). */
  SMS_DRIVER: z.enum(["log", "twilio", "http"]).default("log"),
  /** Expéditeur SMS : numéro E.164 ou nom alphanumérique (11 caractères max). */
  SMS_FROM: z.string().max(20).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Pilote `http` : URL, méthode, en-têtes (JSON) et corps (gabarit avec {{to}}, {{message}}, {{from}}). */
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_METHOD: z.enum(["POST", "GET"]).default("POST"),
  SMS_HTTP_HEADERS: z.string().optional(),
  SMS_HTTP_BODY: z.string().optional(),
  SMS_HTTP_CONTENT_TYPE: z.enum(["json", "form"]).default("json"),
  /** File des notifications : `sync` (sans Redis, défaut) ou `bullmq` (Redis, 5 reprises à intervalle croissant). */
  NOTIFICATIONS_QUEUE: z.enum(["sync", "bullmq"]).default("sync"),
  REDIS_URL: z.string().optional(),
  /** Délai de base (ms) avant la première reprise ; il double à chaque nouvelle tentative. */
  NOTIFICATIONS_RETRY_BASE_MS: z.coerce.number().int().min(0).default(30_000),
}).superRefine((env, ctx) => {
  const need = (cond: boolean, path: string, message: string) => { if (!cond) ctx.addIssue({ code: "custom", path: [path], message }); };
  if (env.MAIL_DRIVER === "smtp") need(!!env.SMTP_URL, "SMTP_URL", "obligatoire avec MAIL_DRIVER=smtp");
  if (env.SMS_DRIVER === "twilio") {
    need(!!env.TWILIO_ACCOUNT_SID, "TWILIO_ACCOUNT_SID", "obligatoire avec SMS_DRIVER=twilio");
    need(!!env.TWILIO_AUTH_TOKEN, "TWILIO_AUTH_TOKEN", "obligatoire avec SMS_DRIVER=twilio");
    need(!!env.SMS_FROM, "SMS_FROM", "obligatoire avec SMS_DRIVER=twilio");
  }
  if (env.SMS_DRIVER === "http") {
    need(!!env.SMS_HTTP_URL, "SMS_HTTP_URL", "obligatoire avec SMS_DRIVER=http");
    if (env.SMS_HTTP_HEADERS) {
      try { const h = JSON.parse(env.SMS_HTTP_HEADERS); need(typeof h === "object" && h !== null && !Array.isArray(h), "SMS_HTTP_HEADERS", "objet JSON attendu"); }
      catch { need(false, "SMS_HTTP_HEADERS", "JSON invalide"); }
    }
  }
  if (env.NOTIFICATIONS_QUEUE === "bullmq") need(!!env.REDIS_URL, "REDIS_URL", "obligatoire avec NOTIFICATIONS_QUEUE=bullmq");
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
