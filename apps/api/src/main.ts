import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { setupApp, setupSwagger } from "./setup";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  setupApp(app, env);
  // Documentation interactive : désactivée par défaut en production (inventaire des routes inutile à un attaquant).
  const swagger = (env.SWAGGER ?? (env.NODE_ENV === "production" ? "off" : "on")) === "on";
  if (swagger) setupSwagger(app);
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API prête sur http://localhost:${env.PORT}/api/v1${swagger ? " — docs : /api/docs" : ""}`);
}
void bootstrap();
