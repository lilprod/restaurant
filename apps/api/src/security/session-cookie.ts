import { BadRequestException } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Env } from "../config/env";
import type { Space } from "./accounts.repo";

/**
 * Transport du jeton de rafraîchissement par cookie (web).
 * Le client web l'active avec l'en-tête `X-Session-Transport: cookie` : l'API pose alors le jeton dans un cookie
 * `HttpOnly; SameSite=Strict; Path=/api/v1/<espace>/auth` (Secure en production) et ne le renvoie plus dans le JSON.
 * Sans cet en-tête (mobile, anciens clients), le jeton reste échangé dans le corps : rien ne change pour eux.
 * Protection CSRF : un cookie n'est lu que si l'en-tête personnalisé est présent ; un formulaire ou une image d'un autre
 * site ne peut pas l'envoyer, et un `fetch` d'un autre site déclenche une requête préalable CORS refusée (CORS_ORIGIN).
 */
export const TRANSPORT_HEADER = "x-session-transport";
export const TENANT_SLUG_HEADER = "x-tenant-slug";
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function wantsCookie(req: Request): boolean {
  return req.headers[TRANSPORT_HEADER] === "cookie";
}

/** Nom du cookie : un par espace, et un par restaurant (plusieurs restaurants peuvent être ouverts dans le même navigateur). */
export function cookieName(space: Space, slug?: string | null): string {
  if (space === "platform") return "rt_platform";
  const s = (slug ?? "").toLowerCase();
  if (!SLUG.test(s)) throw new BadRequestException("Restaurant manquant (en-tête X-Tenant-Slug)");
  return `rt_tenant_${s}`;
}

export function slugHeader(req: Request): string | undefined {
  const v = req.headers[TENANT_SLUG_HEADER];
  return typeof v === "string" ? v : undefined;
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || undefined; } catch { return undefined; }
    }
  }
  return undefined;
}

function options(space: Space, env: Pick<Env, "NODE_ENV" | "COOKIE_SECURE">) {
  const secure = (env.COOKIE_SECURE ?? (env.NODE_ENV === "production" ? "on" : "off")) === "on";
  return { httpOnly: true, secure, sameSite: "strict" as const, path: `/api/v1/${space}/auth` };
}

export function setSessionCookie(res: Response, env: Pick<Env, "NODE_ENV" | "COOKIE_SECURE">, space: Space, name: string, token: string, expiresAt: Date) {
  res.cookie(name, token, { ...options(space, env), expires: expiresAt });
}

export function clearSessionCookie(res: Response, env: Pick<Env, "NODE_ENV" | "COOKIE_SECURE">, space: Space, name: string) {
  res.clearCookie(name, options(space, env));
}
