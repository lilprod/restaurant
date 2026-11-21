import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  PushSubscriptionInput, PushTestInput, PushUnsubscribeInput, pushSubscriptionSchema, pushTestSchema, pushUnsubscribeSchema,
} from "@restaurant/validation";
import { Meta, RequestMeta } from "../common/request-meta";
import { ZodPipe } from "../common/zod.pipe";
import { STAFF } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount, CurrentSessionId } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { PushSubscriptionsService } from "./push-subscriptions.service";

/** Notifications push web du personnel (X5B) : tout le personnel, livreur compris ; jamais un client. */
@ApiTags("Restaurant · Notifications push")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF, "DRIVER")
@Controller("tenant/push")
export class PushController {
  constructor(private readonly push: PushSubscriptionsService) {}

  @Get("config")
  @ApiOperation({ summary: "Clé publique VAPID et état du push (actif ou non) sur ce serveur" })
  config() {
    return this.push.config();
  }

  @Post("subscriptions") @HttpCode(200)
  @ApiOperation({ summary: "Enregistre (ou met à jour) l'abonnement de cet appareil pour le compte connecté ; un endpoint déjà connu est réattribué" })
  subscribe(
    @CurrentAccount() a: Account, @CurrentSessionId() sid: string, @Meta() meta: RequestMeta,
    @Body(new ZodPipe(pushSubscriptionSchema)) body: PushSubscriptionInput,
  ) {
    return this.push.subscribe(a, sid, body, meta.userAgent);
  }

  @Delete("subscriptions") @HttpCode(204)
  @ApiOperation({ summary: "Supprime l'abonnement de cet appareil (par endpoint)" })
  async unsubscribe(@CurrentAccount() a: Account, @Body(new ZodPipe(pushUnsubscribeSchema)) body: PushUnsubscribeInput) {
    await this.push.unsubscribe(a, body.endpoint);
  }

  @Post("test") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Envoie une notification de test à soi-même" })
  test(@CurrentAccount() a: Account, @Body(new ZodPipe(pushTestSchema)) body: PushTestInput) {
    return this.push.test(a, body.endpoint);
  }
}
