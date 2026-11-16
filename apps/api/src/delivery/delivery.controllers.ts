import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  CompleteDeliveryInput, DeliveryZoneInput, DeliveryZoneUpdate, ListDeliveriesQuery,
  assignDeliverySchema, completeDeliverySchema, deliveryZoneInputSchema, deliveryZoneUpdateSchema, failDeliverySchema, listDeliveriesQuerySchema, settleDeliveriesSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { FLOOR, MANAGERS } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { PlanFeature, PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { DeliveryService } from "./delivery.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();

/**
 * X2 — Livraison (module `delivery` du plan, sinon `403 {code: "PLAN_FEATURE"}`). Salle : dispatch ; responsables : zones et rapprochement ;
 * livreur (rôle DRIVER) : uniquement `mine/*`, ses propres livraisons.
 */
@ApiTags("Restaurant · Livraison")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("delivery")
@TenantRoles(...FLOOR)
@Controller("tenant/delivery")
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  // Routes statiques avant `:id`
  @Get("zones") zones(@CurrentAccount() a: Account) { return this.delivery.zones(t(a)); }

  @Post("zones") @TenantRoles(...MANAGERS)
  createZone(@CurrentAccount() a: Account, @Body(new ZodPipe(deliveryZoneInputSchema)) body: DeliveryZoneInput) { return this.delivery.createZone(a, body); }

  @Patch("zones/:id") @TenantRoles(...MANAGERS)
  updateZone(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(deliveryZoneUpdateSchema)) body: DeliveryZoneUpdate) { return this.delivery.updateZone(a, id, body); }

  @Delete("zones/:id") @TenantRoles(...MANAGERS)
  deleteZone(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.delivery.deleteZone(a, id); }

  @Get("drivers") drivers(@CurrentAccount() a: Account) { return this.delivery.drivers(t(a)); }

  @Get("settlements") @TenantRoles(...MANAGERS)
  settlements(@CurrentAccount() a: Account) { return this.delivery.settlements(t(a)); }

  @Post("settlements") @HttpCode(200) @TenantRoles(...MANAGERS)
  settle(@CurrentAccount() a: Account, @Body(new ZodPipe(settleDeliveriesSchema)) body: { driverId: string }) { return this.delivery.settle(a, body.driverId); }

  // Livreur
  @Get("mine") @TenantRoles("DRIVER")
  mine(@CurrentAccount() a: Account, @Query(new ZodPipe(listDeliveriesQuerySchema)) q: ListDeliveriesQuery) { return this.delivery.mine(a, q); }

  @Get("mine/:id") @TenantRoles("DRIVER")
  mineGet(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.delivery.mineGet(a, id); }

  @Post("mine/:id/pickup") @HttpCode(200) @TenantRoles("DRIVER")
  pickup(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.delivery.pickup(a, id); }

  @Post("mine/:id/deliver") @HttpCode(200) @TenantRoles("DRIVER")
  deliver(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(completeDeliverySchema)) body: CompleteDeliveryInput) { return this.delivery.complete(a, id, body); }

  @Post("mine/:id/fail") @HttpCode(200) @TenantRoles("DRIVER")
  fail(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(failDeliverySchema)) body: { reason: string }) { return this.delivery.fail(a, id, body.reason); }

  // Dispatch
  @Get() board(@CurrentAccount() a: Account, @Query(new ZodPipe(listDeliveriesQuerySchema)) q: ListDeliveriesQuery) { return this.delivery.board(t(a), q); }

  @Get(":id") get(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.delivery.get(t(a), id); }

  @Post(":id/assign") @HttpCode(200)
  assign(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(assignDeliverySchema)) body: { driverId: string }) { return this.delivery.assign(a, id, body.driverId); }
}
