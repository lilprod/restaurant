import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { PlatformPrincipal, PlatformRequest } from "./platform-auth.guard";

export const CurrentPlatformUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PlatformPrincipal =>
    ctx.switchToHttp().getRequest<PlatformRequest>().platformUser,
);
