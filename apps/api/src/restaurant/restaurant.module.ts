import { Module } from "@nestjs/common";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { RealtimeService } from "../realtime/realtime.service";
import { TenantModule } from "../tenant/tenant.module";
import { DashboardService } from "./dashboard.service";
import { MenuService } from "./menu.service";
import { OrdersService } from "./orders.service";
import { PlanLimitsService } from "./plan-limits.service";
import { RegisterService } from "./register.service";
import {
  KitchenController, MenuController, OrdersController, PublicMenuController, RegisterController, StaffController,
  TablesController, TenantDashboardController,
} from "./restaurant.controllers";
import { StaffService } from "./staff.service";
import { TablesService } from "./tables.service";

/** Phase 1 : équipe, tables, menu, commandes, cuisine (temps réel), encaissement, caisse, tableau de bord. */
@Module({
  imports: [TenantModule],
  controllers: [
    StaffController, TablesController, MenuController, PublicMenuController, OrdersController, KitchenController,
    RegisterController, TenantDashboardController,
  ],
  providers: [
    PlanLimitsService, StaffService, TablesService, MenuService, OrdersService, RegisterService, DashboardService,
    RealtimeService, RealtimeGateway,
  ],
})
export class RestaurantModule {}
