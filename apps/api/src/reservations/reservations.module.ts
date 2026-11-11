import { Module } from "@nestjs/common";
import { RestaurantModule } from "../restaurant/restaurant.module";
import { TenantModule } from "../tenant/tenant.module";
import { PublicReservationsController, ReservationsController, ScheduleController, WaitlistController } from "./reservations.controllers";
import { ReservationsService } from "./reservations.service";
import { ReservationsTasks } from "./reservations.tasks";
import { ScheduleService } from "./schedule.service";
import { WaitlistService } from "./waitlist.service";

/**
 * P2A — Réservations : horaires et fermetures, disponibilités, attribution des tables (contrainte d'exclusion en base),
 * cycle de vie (confirmer, installer, terminer, annuler, absent), liste d'attente, réservation en ligne sans compte,
 * notifications X1 (confirmation, modification, annulation, rappel la veille, place libérée).
 * `RealtimeService` et `TablesService` viennent de `RestaurantModule` (une seule passerelle Socket.io).
 */
@Module({
  imports: [TenantModule, RestaurantModule],
  controllers: [ReservationsController, ScheduleController, WaitlistController, PublicReservationsController],
  providers: [ReservationsService, ScheduleService, WaitlistService, ReservationsTasks],
  exports: [ReservationsService],
})
export class ReservationsModule {}
