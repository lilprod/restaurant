import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { makeLogger, requestLogging } from "./common/logging";
import { loadEnv } from "./config/env";
import { findPrivilegedRole } from "./prisma/db-role-check";
import { PrismaService } from "./prisma/prisma.service";
import { setupApp, setupSwagger } from "./setup";

async function bootstrap() {
  const env = loadEnv();
  const logger = makeLogger(env.LOG_FORMAT ?? (env.NODE_ENV === "production" ? "json" : "text"));
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.use(requestLogging(logger));
  setupApp(app, env);
  // Documentation interactive : désactivée par défaut en production (inventaire des routes inutile à un attaquant).
  const swagger = (env.SWAGGER ?? (env.NODE_ENV === "production" ? "off" : "on")) === "on";
  if (swagger) setupSwagger(app);
  await app.init();
  // La RLS est inopérante pour un superuser / BYPASSRLS : en production, on refuse de démarrer avec un tel rôle.
  const privileged = await findPrivilegedRole(app.get(PrismaService));
  if (privileged) {
    const msg = `${privileged} : la RLS (isolation des restaurants) serait ignorée`;
    if (env.NODE_ENV === "production" && env.ALLOW_PRIVILEGED_DB !== "on") {
      logger.error(`${msg}. Utilisez un rôle applicatif restreint (scripts/deploy/migrate.sh) ou posez ALLOW_PRIVILEGED_DB=on.`, "Bootstrap");
      await app.close();
      process.exit(1);
    }
    logger.warn(msg, "Bootstrap");
  }
  await app.listen(env.PORT);
  logger.log(`API prête sur le port ${env.PORT} (/api/v1${swagger ? ", docs : /api/docs" : ""})`, "Bootstrap");
}
bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
