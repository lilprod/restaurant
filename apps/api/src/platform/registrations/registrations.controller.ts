import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  RegistrationInput, listRegistrationsQuerySchema, registrationInputSchema, rejectRegistrationSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { CurrentPlatformUser } from "../auth/current-platform-user.decorator";
import { PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";
import { PlansService } from "../plans/plans.service";
import { RegistrationsService } from "./registrations.service";

/** Routes publiques (sans authentification) : formulaire d'inscription d'un restaurant. */
@ApiTags("Public · Inscription")
@Controller("public")
export class PublicRegistrationController {
  constructor(private readonly registrations: RegistrationsService, private readonly plans: PlansService) {}

  @Get("plans")
  @ApiOperation({ summary: "Plans disponibles à l'inscription" })
  plansList() { return this.plans.listPublic(); }

  @Post("registrations")
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: "Demande d'inscription d'un restaurant (validée ensuite par le SuperAdmin)" })
  submit(@Body(new ZodPipe(registrationInputSchema)) body: RegistrationInput) {
    return this.registrations.submit(body);
  }
}

@ApiTags("Plateforme · Inscriptions")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform/registrations")
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  @Get()
  list(@Query(new ZodPipe(listRegistrationsQuerySchema)) q: { status?: string }) {
    return this.registrations.list(q.status);
  }

  @Post(":id/approve") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  approve(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(z.object({ planId: z.string().uuid().optional() }))) body: { planId?: string },
    @CurrentPlatformUser() u: PlatformPrincipal,
  ) {
    return this.registrations.approve(id, u.id, body.planId);
  }

  @Post(":id/reject") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  reject(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rejectRegistrationSchema)) body: { reason: string },
    @CurrentPlatformUser() u: PlatformPrincipal,
  ) {
    return this.registrations.reject(id, body.reason, u.id);
  }
}
