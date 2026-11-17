import {
  BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor, UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { Observable, catchError, defer, from, map, mergeMap, of, switchMap, throwError } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthedRequest } from "../security/space-auth.guard";

/** Durée de conservation d'une réponse rejouable. */
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
/** Une requête « en cours » plus ancienne est considérée comme perdue (arrêt du serveur) : la clé peut être reprise. */
const STALE_PENDING_MS = 2 * 60_000;
const KEY_FORMAT = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * En-tête `Idempotency-Key` (X5) : une requête rejouée avec la même clé renvoie la réponse déjà produite
 * (en-tête `Idempotent-Replayed: true`) sans refaire l'opération. À poser sur les routes qui créent de l'argent ou
 * des commandes. Sans en-tête, la route se comporte comme avant.
 * - même clé, autre corps ou autre route : 422 ; même clé encore en cours de traitement : 409 (à réessayer) ;
 * - seules les réponses de succès sont conservées : une erreur libère la clé (on peut réessayer après correction) ;
 * - la clé est propre au restaurant (jamais partagée entre deux restaurants), et à l'utilisateur qui l'a posée.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<AuthedRequest & { headers: Record<string, string | string[] | undefined>; method: string; originalUrl: string; body?: unknown }>();
    const raw = req.headers["idempotency-key"];
    if (raw === undefined) return next.handle();
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !KEY_FORMAT.test(key)) throw new BadRequestException("En-tête Idempotency-Key invalide (8 à 128 caractères : lettres, chiffres, _ . : -)");
    const acc = req.account;
    if (!acc?.tenantId) return next.handle();
    const res = http.getResponse<{ setHeader(k: string, v: string): void }>();
    // Nest applique le code HTTP de la route après les intercepteurs : on le lit dans les métadonnées (@HttpCode, sinon 201 pour POST).
    const statusCode = (Reflect.getMetadata("__httpCode__", ctx.getHandler()) as number | undefined) ?? (req.method === "POST" ? 201 : 200);
    const tenantId = acc.tenantId;
    const path = req.originalUrl.split("?")[0]!;
    const requestHash = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");

    return defer(() => this.claim(tenantId, key, req.method, path, requestHash, acc.id)).pipe(
      switchMap((replay) => {
        if (replay) {
          res.setHeader("Idempotent-Replayed", "true");
          return of(replay.response);
        }
        return next.handle().pipe(
          mergeMap((body) => from(this.store(tenantId, key, statusCode, body)).pipe(map(() => body))),
          // L'échec n'est pas mémorisé : on libère la clé pour qu'un nouvel essai refasse l'opération.
          catchError((e: unknown) => from(this.release(tenantId, key)).pipe(mergeMap(() => throwError(() => e)))),
        );
      }),
    );
  }

  /** Réserve la clé, ou renvoie la réponse déjà enregistrée. */
  private async claim(tenantId: string, key: string, method: string, path: string, requestHash: string, accountId: string) {
    const now = new Date();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.prisma.asTenant(tenantId, (tx) => tx.idempotencyKey.create({
          data: { tenantId, key, method, path, requestHash, accountId, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) },
        }));
        return null;
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
      const row = await this.prisma.asTenant(tenantId, (tx) => tx.idempotencyKey.findUnique({ where: { tenantId_key: { tenantId, key } } }));
      if (!row) continue;                                   // purgée entre-temps : on retente la réservation
      if (row.expiresAt <= now) {
        await this.release(tenantId, key);
        continue;
      }
      if (row.method !== method || row.path !== path || row.requestHash !== requestHash || row.accountId !== accountId) {
        throw new UnprocessableEntityException("Cette clé d'idempotence a déjà servi pour une autre requête");
      }
      if (row.statusCode === null) {
        if (now.getTime() - row.createdAt.getTime() > STALE_PENDING_MS) { await this.release(tenantId, key); continue; }
        throw new ConflictException("Cette requête est déjà en cours de traitement : réessayez dans un instant");
      }
      return { statusCode: row.statusCode, response: row.response };
    }
    throw new ConflictException("Cette requête est déjà en cours de traitement : réessayez dans un instant");
  }

  private store(tenantId: string, key: string, statusCode: number, body: unknown) {
    const response = (body === undefined ? null : JSON.parse(JSON.stringify(body))) as Prisma.InputJsonValue;
    return this.prisma.asTenant(tenantId, (tx) => tx.idempotencyKey.updateMany({ where: { tenantId, key }, data: { statusCode, response } }));
  }

  private release(tenantId: string, key: string) {
    return this.prisma.asTenant(tenantId, (tx) => tx.idempotencyKey.deleteMany({ where: { tenantId, key } })).catch(() => undefined);
  }
}
