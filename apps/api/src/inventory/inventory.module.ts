import { Module } from "@nestjs/common";
import { RestaurantModule } from "../restaurant/restaurant.module";
import { PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantModule } from "../tenant/tenant.module";
import { InventoryController, PurchaseOrdersController, RecipesController, SuppliersController } from "./inventory.controllers";
import { InventoryService } from "./inventory.service";
import { PurchasingService } from "./purchasing.service";
import { RecipesService } from "./recipes.service";

/**
 * P3 — Stock : ingrédients, recettes (plats et options), mouvements, pertes, inventaires, alertes, fournisseurs, achats.
 * `StockService` (déduction dans la transaction des commandes) est fourni par `RestaurantModule`, qui l'exporte :
 * une seule instance de `RealtimeService` (celle reliée à la passerelle Socket.io).
 */
@Module({
  imports: [TenantModule, RestaurantModule],
  controllers: [InventoryController, RecipesController, SuppliersController, PurchaseOrdersController],
  providers: [InventoryService, RecipesService, PurchasingService, PlanFeatureGuard],
})
export class InventoryModule {}
