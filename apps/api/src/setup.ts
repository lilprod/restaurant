import { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { installFrenchErrors } from "@restaurant/validation";
import helmet from "helmet";
import { resolve } from "node:path";
import type { Env } from "./config/env";

/** Configuration HTTP commune à main.ts et aux tests e2e. */
export function setupApp(app: INestApplication, env: Pick<Env, "CORS_ORIGIN" | "UPLOAD_DIR">) {
  installFrenchErrors();                                // messages de validation en français
  const express = app as NestExpressApplication;
  express.set("trust proxy", 1);                       // IP réelle derrière un reverse proxy (sessions, journal)
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));   // images servies à un autre domaine (web)
  app.setGlobalPrefix("api/v1", { exclude: ["uploads/(.*)"] });
  app.enableCors({ origin: env.CORS_ORIGIN.split(","), credentials: true });
  // Logos / favicons : noms aléatoires donc cache long ; « sandbox » + nosniff neutralisent tout contenu actif.
  express.useStaticAssets(resolve(env.UPLOAD_DIR), {
    prefix: "/uploads/",
    index: false,
    dotfiles: "deny",
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    },
  });
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle("Restaurant SaaS — API")
    .setDescription("API REST. Espace plateforme (SuperAdmin) et espaces restaurants (tenants).")
    .setVersion("0.2.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, doc));
}
