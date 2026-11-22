import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

/**
 * Délais des transactions interactives. Les valeurs par défaut de Prisma (attente d'une connexion 2 s, durée 5 s) font échouer
 * en 500 les requêtes d'un coup de feu (commandes simultanées qui verrouillent les mêmes lignes) sur un serveur à peu de connexions.
 */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Exécute `fn` dans une transaction limitée à un tenant (`app.tenant_id`, voir prisma/sql/rls.sql). */
  asTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /**
   * Exécute `fn` dans une transaction avec `app.bypass_rls = on` : réservé aux opérations
   * de la plateforme (SuperAdmin), qui doivent lire/écrire les données de plusieurs tenants.
   */
  asPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }
}
