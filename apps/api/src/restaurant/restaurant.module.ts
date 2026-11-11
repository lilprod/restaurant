import { Module } from "@nestjs/common";
import { StockService } from "../inventory/stock.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RealtimeService } from "../realtime/realtime.service";
import { TenantModule } from "../tenant/tenant.module";
import { DashboardService } from "./dashboard.service";
import { Clock } from "../common/clock";
import { MenuExtrasService } from "./menu-extras.service";
import { MenuService } from "./menu.service";
import { OrdersService } from "./orders.service";
import { PlanLimitsService } from "./plan-limits.service";
import { RegisterService } from "./register.service";
import {
  KitchenController, MenuController, MenuExtrasController, OrdersController, PublicMenuController, RegisterController, StaffController,
  TablesController, TenantDashboardController,
} from "./restaurant.controllers";
import { StaffService } from "./staff.service";
import { TablesService } from "./tables.service";

/** Phase 1 : équipe, tables, menu, commandes, cuisine (temps réel), encaissement, caisse, tableau de bord. */
@Module({
  imports: [TenantModule],
  controllers: [
    StaffController, TablesController, MenuController, MenuExtrasController, PublicMenuController, OrdersController, KitchenController,
    RegisterController, TenantDashboardController,
  ],
  providers: [
    PlanLimitsService, StaffService, TablesService, MenuService, MenuExtrasService, Clock, OrdersService, RegisterService, DashboardService,
    RealtimeService, RealtimeGateway,
    StockService, // P3 : déduction de stock dans la transaction des commandes (module Stock : src/inventory)
  ],
  exports: [RealtimeService, MenuService, StockService],
})
export class RestaurantModule {}
