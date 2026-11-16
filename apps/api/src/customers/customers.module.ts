import { Module } from "@nestjs/common";
import { ReservationsModule } from "../reservations/reservations.module";
import { TenantModule } from "../tenant/tenant.module";
import { CustomerSpaceController, OrderTrackingController, PublicCustomerController, ReviewsController } from "./customers.controllers";
import { CustomersService } from "./customers.service";
import { ReviewsService } from "./reviews.service";
import { TrackingService } from "./tracking.service";

/**
 * P2C — Espace client : comptes clients (rôle CUSTOMER), réservations rattachées, suivi de commande par lien de ticket,
 * avis (modération, réponse, statistiques, affichage public), export et suppression RGPD.
 */
@Module({
  imports: [TenantModule, ReservationsModule],
  controllers: [PublicCustomerController, CustomerSpaceController, ReviewsController, OrderTrackingController],
  providers: [CustomersService, ReviewsService, TrackingService],
  exports: [ReviewsService],
})
export class CustomersModule {}
