import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RecordPaymentInput, listPaymentsQuerySchema, recordPaymentSchema, voidPaymentSchema } from "@restaurant/validation";
import { ZodPipe } from "../../common/zod.pipe";
import { CurrentPlatformUser, PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";
import { PaymentsService } from "./payments.service";

@ApiTags("Plateforme · Paiements de licence")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@Controller("platform/payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post() @PlatformRoles("SUPER_ADMIN")
  @ApiOperation({ summary: "Enregistrer un paiement (espèces, carte, Flooz, TMoney) et prolonger la licence" })
  record(@Body(new ZodPipe(recordPaymentSchema)) body: RecordPaymentInput, @CurrentPlatformUser() u: PlatformPrincipal) {
    return this.payments.record(body, u.id);
  }

  @Get()
  list(@Query(new ZodPipe(listPaymentsQuerySchema)) q: { tenantId?: string; method?: string; from?: Date; to?: Date; page: number; pageSize: number }) {
    return this.payments.list(q);
  }

  @Get(":id") get(@Param("id", ParseUUIDPipe) id: string) { return this.payments.receipt(id); }

  @Post(":id/void") @HttpCode(200) @PlatformRoles("SUPER_ADMIN")
  @ApiOperation({ summary: "Annuler le dernier paiement d'une licence (erreur de saisie)" })
  void(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodPipe(voidPaymentSchema)) body: { reason: string },
    @CurrentPlatformUser() u: PlatformPrincipal,
  ) {
    return this.payments.void(id, body.reason, u.id);
  }
}
