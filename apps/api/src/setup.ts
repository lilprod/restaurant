import { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { installFrenchErrors } from "@restaurant/validation";
import helmet from "helmet";
import { resolve } from "node:path";
import { describeZodSchemas } from "./common/openapi-zod";
import type { Request, Response, NextFunction } from "express";
import type { Env } from "./config/env";
import { StorageService } from "./storage/storage.service";

/** En-têtes des fichiers envoyés : noms aléatoires donc cache long ; « sandbox » + nosniff neutralisent tout contenu actif. */
const uploadHeaders = (res: { setHeader(k: string, v: string): unknown }) => {
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
};

/** Configuration HTTP commune à main.ts et aux tests e2e. */
export function setupApp(app: INestApplication, env: Pick<Env, "CORS_ORIGIN" | "UPLOAD_DIR"> & Partial<Pick<Env, "TRUST_PROXY" | "STORAGE_DRIVER" | "S3_PUBLIC_URL">>) {
  installFrenchErrors();                                // messages de validation en français
  const express = app as NestExpressApplication;
  // IP réelle derrière N reverse proxys (limitation de débit, sessions, journal). 0 si l'API est exposée directement :
  // sinon un client pourrait choisir son IP via X-Forwarded-For et contourner la limitation de débit.
  express.set("trust proxy", env.TRUST_PROXY ?? 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));   // images servies à un autre domaine (web)
  app.setGlobalPrefix("api/v1", { exclude: ["uploads/(.*)"] });
  app.enableCors({ origin: env.CORS_ORIGIN.split(","), credentials: true });
  if (env.STORAGE_DRIVER === "s3") {
    // Bucket privé : l'API relaie les fichiers (mêmes en-têtes que le disque). Inutile si S3_PUBLIC_URL pointe vers le bucket / son CDN.
    if (!env.S3_PUBLIC_URL) {
      const storage = app.get(StorageService, { strict: false });
      express.use("/uploads", (req: Request, res: Response, next: NextFunction) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        let key: string;
        try { key = decodeURIComponent(req.path.replace(/^\//, "")); } catch { key = ""; }
        storage.read(key).then((obj) => {
          if (!obj) return res.status(404).json({ statusCode: 404, message: "Fichier introuvable" });
          uploadHeaders(res);
          res.setHeader("Content-Type", obj.contentType);
          if (obj.length !== undefined) res.setHeader("Content-Length", String(obj.length));
          if (req.method === "HEAD") { obj.body.destroy(); return res.end(); }
          obj.body.on("error", () => res.destroy());
          obj.body.pipe(res);
        }).catch(next);
      });
    }
  } else {
    express.useStaticAssets(resolve(env.UPLOAD_DIR), { prefix: "/uploads/", index: false, dotfiles: "deny", setHeaders: uploadHeaders });
  }
  app.enableShutdownHooks();
}

/** Document OpenAPI : routes décrites par Nest, corps et requêtes décrits par les schémas Zod partagés. */
export function buildApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle("Restaurant SaaS — API")
    .setDescription("API REST. Espace plateforme (SuperAdmin) et espaces restaurants (tenants).")
    .setVersion("0.2.0")
    .addBearerAuth()
    .build();
  return describeZodSchemas(app, SwaggerModule.createDocument(app, config));
}

export function setupSwagger(app: INestApplication) {
  SwaggerModule.setup("api/docs", app, buildApiDocument(app));
}
