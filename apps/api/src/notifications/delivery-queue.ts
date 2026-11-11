import { Logger } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

/** Nombre total de tentatives (1 envoi + 4 reprises). */
export const MAX_ATTEMPTS = 5;

export type DeliveryJob =
  | { logId: string; tenantId: string | null; channel: "EMAIL"; to: string; from: string; fromName?: string; subject: string; text: string; html: string }
  | { logId: string; tenantId: string | null; channel: "SMS"; to: string; text: string };

/** Exécute une tentative ; `true` = terminé (envoyé ou définitivement abandonné), `false` = à réessayer. */
export type JobProcessor = (job: DeliveryJob, attempt: number, maxAttempts: number) => Promise<boolean>;

export interface DeliveryQueue {
  readonly mode: "sync" | "bullmq";
  add(job: DeliveryJob): Promise<void>;
  /** Attend la fin des reprises en cours (tests). */
  flush(): Promise<void>;
  close(): Promise<void>;
}

const delayFor = (base: number, attempt: number) => base * 2 ** (attempt - 1);

/**
 * Mode sans Redis (développement, tests) : la première tentative est exécutée tout de suite, les reprises
 * (délai doublé à chaque fois) sont planifiées en mémoire. Perdues au redémarrage : ne pas utiliser en production.
 */
export class SyncQueue implements DeliveryQueue {
  readonly mode = "sync" as const;
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly process: JobProcessor, private readonly retryBaseMs: number) {}

  async add(job: DeliveryJob): Promise<void> {
    await this.run(job, 1);
  }

  private async run(job: DeliveryJob, attempt: number): Promise<void> {
    const done = await this.process(job, attempt, MAX_ATTEMPTS);
    if (done || attempt >= MAX_ATTEMPTS) return;
    const retry = new Promise<void>((resolve) => setTimeout(resolve, delayFor(this.retryBaseMs, attempt)))
      .then(() => this.run(job, attempt + 1))
      .finally(() => this.pending.delete(retry));
    this.pending.add(retry);
  }

  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/** Mode production : BullMQ + Redis, 5 tentatives à intervalle croissant (exponentiel), reprise après redémarrage. */
export class BullQueue implements DeliveryQueue {
  readonly mode = "bullmq" as const;
  private readonly log = new Logger("NotificationsQueue");
  private readonly connection: IORedis;
  private readonly queue: Queue<DeliveryJob>;
  private readonly worker: Worker<DeliveryJob>;

  constructor(redisUrl: string, process: JobProcessor, private readonly retryBaseMs: number, name = "notifications") {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<DeliveryJob>(name, { connection: this.connection });
    this.worker = new Worker<DeliveryJob>(
      name,
      async (job) => {
        const done = await process(job.data, job.attemptsMade + 1, MAX_ATTEMPTS);
        if (!done) throw new Error("Échec d'envoi, nouvelle tentative planifiée");
      },
      { connection: this.connection },
    );
    this.worker.on("error", (e) => this.log.error(e.message));
  }

  async add(job: DeliveryJob): Promise<void> {
    await this.queue.add("send", job, {
      attempts: MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: this.retryBaseMs },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async flush(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const c = await this.queue.getJobCounts("waiting", "active", "delayed");
      if (!c.waiting && !c.active && !c.delayed) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    this.connection.disconnect();
  }
}
