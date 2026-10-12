import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

/** Configuration HTTP commune à main.ts et aux tests e2e. */
export function setupApp(app: INestApplication, corsOrigin: string) {
  app.setGlobalPrefix("api/v1");
  app.enableCors({ origin: corsOrigin.split(","), credentials: true });
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication) {
  const doc = new DocumentBuilder()
    .setTitle("Restaurant SaaS — API")
    .setDescription("API REST. Espace plateforme (SuperAdmin) et espaces restaurants (tenants).")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, doc));
}
