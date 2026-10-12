import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlanInput, planInputSchema, planUpdateSchema } from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { CurrentPlatformUser } from "../auth/current-platform-user.decorator";
import { PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";
import { PlansService } from "./plans.service";

@ApiTags("Plateforme · Plans")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform/plans")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get() list() { return this.plans.list(); }

  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.plans.get(id); }

  @Post() @PlatformRoles("SUPER_ADMIN")
  create(@Body(new ZodPipe(planInputSchema)) body: PlanInput, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.plans.create(body, u.id);
  }

  @Patch(":id") @PlatformRoles("SUPER_ADMIN")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(planUpdateSchema)) body: Partial<PlanInput>,
    @CurrentPlatformUser() u: PlatformPrincipal,
  ) {
    return this.plans.update(id, body, u.id);
  }
}
