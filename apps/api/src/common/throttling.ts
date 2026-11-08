import { ExecutionContext } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Throttle } from "@nestjs/throttler";

/** Nom du plafond « IP + identifiant » (en plus du plafond par IP, nommé `default`). */
export const PAIR = "loginPair";

const off = () => !!process.env.DISABLE_THROTTLE;

/** Identifiant visé par la tentative : email (connexion) ou jeton de défi 2FA (haché), en minuscules. */
export function loginTracker(req: Record<string, any>): string {
  const body = (req.body ?? {}) as { email?: unknown; challengeToken?: unknown };
  const id = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : typeof body.challengeToken === "string" ? createHash("sha256").update(body.challengeToken).digest("hex").slice(0, 24) : "";
  return `${req.ip ?? ""}|${id}`;
}

/** Plafond appliqué seulement aux routes marquées par `@LoginThrottle()`. */
export const pairThrottler = {
  name: PAIR, ttl: 60_000, limit: 10, getTracker: loginTracker,
  skipIf: (ctx: ExecutionContext) => off() || !Reflect.getMetadata("THROTTLER:LIMIT" + PAIR, ctx.getHandler()),
};

/** Connexion : 10/min par couple IP + identifiant ET 60/min par IP (une équipe derrière le même réseau n'est pas bloquée). */
export const LoginThrottle = () =>
  Throttle({ default: { limit: 60, ttl: 60_000 }, [PAIR]: { limit: 10, ttl: 60_000 } });
