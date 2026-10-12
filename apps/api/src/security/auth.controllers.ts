import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { CanActivate, Type } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  changePasswordSchema, forgotPasswordSchema, loginSchema, passwordConfirmSchema, profileUpdateSchema,
  refreshSchema, resetPasswordSchema, tenantLoginSchema, twoFactorEnableSchema, twoFactorVerifySchema,
} from "@restaurant/validation";
import { Meta, RequestMeta } from "../common/request-meta";
import { ZodPipe } from "../common/zod.pipe";
import { Account, Space } from "./accounts.repo";
import { AccountService } from "./account.service";
import { AuthService } from "./auth.service";
import { AllowRestricted, CurrentAccount, CurrentSessionId } from "./space-auth.guard";

const eq = (a: string) => (a === "tenant" ? tenantLoginSchema : loginSchema);

/** Connexion, 2FA, rafraîchissement, mot de passe oublié : mêmes routes dans les deux espaces. */
export function createAuthController(space: Space, prefix: string, tag: string): Type<unknown> {
  @ApiTags(tag)
  @Controller(prefix)
  class SpaceAuthController {
    constructor(@Inject(AuthService) private readonly auth: AuthService) {}

    @Post("login") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
    login(@Body(new ZodPipe(eq(space))) body: { email: string; password: string; tenantSlug?: string }, @Meta() meta: RequestMeta) {
      return this.auth.login(space, body, meta);
    }

    @Post("2fa/verify") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
    verify2fa(@Body(new ZodPipe(twoFactorVerifySchema)) body: { challengeToken: string; code: string }, @Meta() meta: RequestMeta) {
      return this.auth.verifyTwoFactor(body.challengeToken, body.code, meta);
    }

    @Post("refresh") @HttpCode(200) @Throttle({ default: { limit: 30, ttl: 60_000 } })
    refresh(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }, @Meta() meta: RequestMeta) {
      return this.auth.refresh(space, body.refreshToken, meta);
    }

    @Post("logout") @HttpCode(204)
    async logout(@Body(new ZodPipe(refreshSchema)) body: { refreshToken: string }) {
      await this.auth.logout(body.refreshToken);
    }

    @Post("forgot-password") @HttpCode(202) @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
    async forgot(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string; tenantSlug?: string }) {
      await this.auth.forgotPassword(space, body);
      return { message: "Si un compte correspond, un email de réinitialisation vient d'être envoyé." };
    }

    @Post("reset-password") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
    async reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; newPassword: string }, @Meta() meta: RequestMeta) {
      await this.auth.resetPassword(space, body.token, body.newPassword, meta);
      return { ok: true };
    }
  }
  return SpaceAuthController;
}

/** « Mon compte » : profil, mot de passe, sessions, double authentification, historique de connexion. */
export function createAccountController(Guard: Type<CanActivate>, prefix: string, tag: string): Type<unknown> {
  @ApiTags(tag)
  @ApiBearerAuth()
  @UseGuards(Guard)
  @Controller(prefix)
  class SpaceAccountController {
    constructor(@Inject(AccountService) private readonly account: AccountService) {}

    @Get("me") @AllowRestricted()
    me(@CurrentAccount() acc: Account) { return this.account.profile(acc); }

    @Patch("profile")
    profile(@CurrentAccount() acc: Account, @Body(new ZodPipe(profileUpdateSchema)) body: Record<string, string | undefined>) {
      return this.account.updateProfile(acc, body);
    }

    @Post("avatar") @ApiConsumes("multipart/form-data")
    @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }))
    avatar(@CurrentAccount() acc: Account, @UploadedFile() file: { buffer: Buffer } | undefined) {
      return this.account.uploadAvatar(acc, file);
    }

    @Post("change-password") @HttpCode(200) @AllowRestricted() @Throttle({ default: { limit: 10, ttl: 60_000 } })
    changePassword(
      @CurrentAccount() acc: Account, @CurrentSessionId() sid: string,
      @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string },
    ) {
      return this.account.changePassword(acc, sid, body.currentPassword, body.newPassword);
    }

    @Get("sessions")
    sessions(@CurrentAccount() acc: Account, @CurrentSessionId() sid: string) { return this.account.sessionsList(acc, sid); }

    @Delete("sessions") @HttpCode(200)
    revokeOthers(@CurrentAccount() acc: Account, @CurrentSessionId() sid: string) { return this.account.revokeOtherSessions(acc, sid); }

    @Delete("sessions/:id") @HttpCode(204)
    revokeOne(@CurrentAccount() acc: Account, @Param("id", ParseUUIDPipe) id: string) { return this.account.revokeSession(acc, id); }

    @Post("2fa/setup") @HttpCode(200) @AllowRestricted()
    setup2fa(@CurrentAccount() acc: Account) { return this.account.twoFactorSetup(acc); }

    @Post("2fa/enable") @HttpCode(200) @AllowRestricted() @Throttle({ default: { limit: 10, ttl: 60_000 } })
    enable2fa(@CurrentAccount() acc: Account, @Body(new ZodPipe(twoFactorEnableSchema)) body: { code: string }) {
      return this.account.twoFactorEnable(acc, body.code);
    }

    @Post("2fa/disable") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
    disable2fa(@CurrentAccount() acc: Account, @Body(new ZodPipe(passwordConfirmSchema)) body: { password: string; code?: string }) {
      return this.account.twoFactorDisable(acc, body.password, body.code);
    }

    @Post("2fa/recovery-codes") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
    recovery(@CurrentAccount() acc: Account, @Body(new ZodPipe(passwordConfirmSchema)) body: { password: string; code?: string }) {
      return this.account.regenerateRecoveryCodes(acc, body.password, body.code);
    }

    @Get("login-history")
    history(@CurrentAccount() acc: Account) { return this.account.loginHistory(acc); }
  }
  return SpaceAccountController;
}
