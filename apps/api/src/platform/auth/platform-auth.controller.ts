import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { loginSchema, refreshSchema } from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { CurrentPlatformUser } from "./current-platform-user.decorator";
import { PlatformAuthGuard, PlatformPrincipal } from "./platform-auth.guard";
import { PlatformAuthService } from "./platform-auth.service";

@ApiTags("Plateforme · Authentification")
@Controller("platform/auth")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Connexion SuperAdmin" })
  login(@Body(new ZodPipe(loginSchema)) body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
    await this.auth.logout(body.refreshToken);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(PlatformAuthGuard)
  me(@CurrentPlatformUser() user: PlatformPrincipal) {
    return this.auth.me(user.id);
  }
}
