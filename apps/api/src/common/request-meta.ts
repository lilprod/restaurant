import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** IP et navigateur de l'appelant (pour les sessions et le journal de connexion). */
export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip ?? null, userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) || null };
});
