import { Module } from "@nestjs/common";
import { MessagingController } from "../messaging/messaging.controller";
import { MessagingService } from "../messaging/messaging.service";
import { RestaurantModule } from "../restaurant/restaurant.module";
import { PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantModule } from "../tenant/tenant.module";
import { AbsencesService } from "./absences.service";
import { AttendanceService } from "./attendance.service";
import { PlanningService } from "./planning.service";
import { ProfilesService } from "./profiles.service";
import { StaffReportsService } from "./reports.service";
import { StaffContext } from "./staff.common";
import { StaffHrController } from "./staff.controllers";

/**
 * P4 — Personnel : fiches RH, planning, pointage (compte ou tablette), absences, performances, paie, et messagerie interne
 * (la messagerie est ouverte à tous les plans). `RealtimeService` vient de `RestaurantModule` (une seule passerelle Socket.io).
 */
@Module({
  imports: [TenantModule, RestaurantModule],
  controllers: [StaffHrController, MessagingController],
  providers: [StaffContext, ProfilesService, PlanningService, AttendanceService, AbsencesService, StaffReportsService, MessagingService, PlanFeatureGuard],
  exports: [StaffReportsService], // P5 : performances du personnel dans les rapports
})
export class StaffModule {}
