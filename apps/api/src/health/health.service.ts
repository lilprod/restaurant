import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";
import { APP_ENV, Env } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";

export interface HealthReport {
  status: "ok" | "degraded";
  checks: { database: "up" | "down"; redis: "up" | "down" | "disabled" };
  uptime: number;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("délai dépassé")), ms).unref())]);

/** État de la base et, quand la file des notifications utilise Redis, de Redis. Aucune donnée sensible dans la réponse. */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private redis?: IORedis;

  constructor(private readonly prisma: PrismaService, @Inject(APP_ENV) private readonly env: Env) {}

  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return { status: database === "up" && redis !== "down" ? "ok" : "degraded", checks: { database, redis }, uptime: Math.round(process.uptime()) };
  }

  private async checkDatabase(): Promise<"up" | "down"> {
    try { await withTimeout(this.prisma.$queryRaw`SELECT 1`, 2000); return "up"; } catch { return "down"; }
  }

  private async checkRedis(): Promise<"up" | "down" | "disabled"> {
    if (this.env.NOTIFICATIONS_QUEUE !== "bullmq" || !this.env.REDIS_URL) return "disabled";
    try {
      this.redis ??= new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 1500, lazyConnect: true })
        .on("error", () => undefined);
      if (this.redis.status === "wait" || this.redis.status === "end") await withTimeout(this.redis.connect(), 2000);
      return (await withTimeout(this.redis.ping(), 2000)) === "PONG" ? "up" : "down";
    } catch { return "down"; }
  }

  async onModuleDestroy() { this.redis?.disconnect(); }
}
