import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadEnv } from "./config/env";
import { setupApp, setupSwagger } from "./setup";

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  setupApp(app, env.CORS_ORIGIN);
  setupSwagger(app);
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API prête sur http://localhost:${env.PORT}/api/v1 — docs : /api/docs`);
}
void bootstrap();
