import { Module } from "@nestjs/common";
import { RestaurantModule } from "../restaurant/restaurant.module";
import { PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantModule } from "../tenant/tenant.module";
import { DeliveryController } from "./delivery.controllers";
import { DeliveryService } from "./delivery.service";

/** X2 — Livraison : zones par quartier, dispatch, parcours du livreur, paiement à la livraison. Dépend de `RestaurantModule` (commandes, temps réel). */
@Module({
  imports: [TenantModule, RestaurantModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, PlanFeatureGuard],
})
export class DeliveryModule {}
