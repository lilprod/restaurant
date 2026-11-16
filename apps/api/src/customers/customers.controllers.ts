import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  claimOrderSchema, customerProfileSchema, customerSignupSchema, deleteAccountSchema, listReviewsQuerySchema, notificationPrefsSchema,
  publicAvailabilityQuerySchema, publicReviewsQuerySchema, publicUpdateReservationSchema, reviewInputSchema, reviewReplySchema, verifyEmailSchema,
  type CustomerProfileInput, type CustomerSignupInput, type ListReviewsQuery, type NotificationPrefs, type PublicAvailabilityQuery,
  type PublicReviewsQuery, type PublicUpdateReservationInput, type ReviewInput, type ReviewReplyInput,
} from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { FLOOR, MANAGERS } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { ReservationsService } from "../reservations/reservations.service";
import { CustomersService } from "./customers.service";
import { ReviewsService } from "./reviews.service";
import { TrackingService } from "./tracking.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const token = (v: string) => { if (!TOKEN.test(v)) throw new NotFoundException("Commande introuvable"); return v; };

/** Sans compte : inscription, suivi de commande par le lien du ticket, avis, avis publiés (limités en débit par IP). */
@ApiTags("Public · Espace client")
@Controller("public")
export class PublicCustomerController {
  constructor(private readonly customers: CustomersService, private readonly tracking: TrackingService, private readonly reviews: ReviewsService) {}

  @Post("tenants/:slug/customers") @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: "Créer un compte client (connexion ensuite par /tenant/auth/login)" })
  signup(@Param("slug") slug: string, @Body(new ZodPipe(customerSignupSchema)) body: CustomerSignupInput) { return this.customers.signup(slug, body); }

  @Get("tracking/:token") @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Statut d'une commande par le lien du ticket (à interroger régulièrement)" })
  track(@Param("token") tk: string) { return this.tracking.view(token(tk)); }

  @Post("tracking/:token/review") @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: "Laisser un avis (une fois la commande clôturée, une fois par commande)" })
  review(@Param("token") tk: string, @Body(new ZodPipe(reviewInputSchema)) body: ReviewInput) { return this.reviews.submitByToken(token(tk), body); }

  @Get("tenants/:slug/reviews") @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Avis publiés (si le restaurant a activé l'affichage)" })
  publicReviews(@Param("slug") slug: string, @Query(new ZodPipe(publicReviewsQuerySchema)) q: PublicReviewsQuery) { return this.reviews.publicList(slug, q); }
}

/** Espace du client connecté (rôle CUSTOMER uniquement). Le compte et le mot de passe : `/tenant/account/*`. */
@ApiTags("Client · Mon espace")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles("CUSTOMER")
@Controller("tenant/customer")
export class CustomerSpaceController {
  constructor(
    private readonly customers: CustomersService, private readonly reservations: ReservationsService,
    private readonly reviews: ReviewsService, private readonly tracking: TrackingService,
  ) {}

  @Get("profile") profile(@CurrentAccount() a: Account) { return this.customers.profile(a); }

  @Patch("profile")
  update(@CurrentAccount() a: Account, @Body(new ZodPipe(customerProfileSchema)) body: CustomerProfileInput) { return this.customers.updateProfile(a, body); }

  @Put("notification-prefs")
  prefs(@CurrentAccount() a: Account, @Body(new ZodPipe(notificationPrefsSchema)) body: NotificationPrefs) { return this.customers.setPreferences(a, body); }

  @Post("verify-email/send") @HttpCode(200) @Throttle({ default: { limit: 3, ttl: 600_000 } })
  sendCode(@CurrentAccount() a: Account) { return this.customers.resendVerification(a); }

  @Post("verify-email") @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 600_000 } })
  verify(@CurrentAccount() a: Account, @Body(new ZodPipe(verifyEmailSchema)) body: { code: string }) { return this.customers.verifyEmail(a, body.code); }

  @Get("export") @ApiOperation({ summary: "Export JSON de toutes les données du client (RGPD)" })
  export(@CurrentAccount() a: Account) { return this.customers.export(a); }

  @Post("delete") @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({ summary: "Supprimer le compte (anonymisation ; mot de passe requis)" })
  remove(@CurrentAccount() a: Account, @Body(new ZodPipe(deleteAccountSchema)) body: { password: string }) { return this.customers.deleteAccount(a, body.password); }

  @Get("reservations") myReservations(@CurrentAccount() a: Account) { return this.reservations.customerList(t(a), a.id); }

  @Get("reservations/:id/availability")
  slots(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Query(new ZodPipe(publicAvailabilityQuerySchema)) q: PublicAvailabilityQuery) {
    return this.reservations.customerAvailability(t(a), a.id, id, q);
  }

  @Patch("reservations/:id")
  modify(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(publicUpdateReservationSchema)) body: PublicUpdateReservationInput) {
    return this.reservations.customerUpdate(t(a), a.id, id, body);
  }

  @Post("reservations/:id/cancel") @HttpCode(200)
  cancel(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.customerCancel(t(a), a.id, id); }

  @Get("orders") orders(@CurrentAccount() a: Account) { return this.customers.orders(a); }

  @Post("orders/claim") @HttpCode(200) @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @ApiOperation({ summary: "Rattacher une commande à son compte avec le lien de son ticket" })
  claim(@CurrentAccount() a: Account, @Body(new ZodPipe(claimOrderSchema)) body: { token: string }) { return this.tracking.claim(a, body.token); }

  @Post("orders/:id/review") @Throttle({ default: { limit: 20, ttl: 600_000 } })
  review(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(reviewInputSchema)) body: ReviewInput) { return this.reviews.submitForCustomer(a, id, body); }
}

/** Écran « Avis » du restaurant (responsables). */
@ApiTags("Restaurant · Avis")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...MANAGERS)
@Controller("tenant/reviews")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get() list(@CurrentAccount() a: Account, @Query(new ZodPipe(listReviewsQuerySchema)) q: ListReviewsQuery) { return this.reviews.list(t(a), q); }
  @Get("stats") stats(@CurrentAccount() a: Account) { return this.reviews.stats(t(a)); }

  @Post(":id/hide") @HttpCode(200) hide(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reviews.hide(a, id, true); }
  @Post(":id/unhide") @HttpCode(200) unhide(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reviews.hide(a, id, false); }

  @Put(":id/reply")
  reply(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(reviewReplySchema)) body: ReviewReplyInput) { return this.reviews.reply(a, id, body.text); }
  @Delete(":id/reply") deleteReply(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reviews.reply(a, id, null); }
}

/** Lien de suivi imprimé sur le ticket. */
@ApiTags("Restaurant · Commandes")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...FLOOR)
@Controller("tenant/orders")
export class OrderTrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get(":id/tracking-link")
  @ApiOperation({ summary: "Lien et jeton de suivi de la commande (stable : réimprimer un ticket ne change pas le lien)" })
  link(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.tracking.linkFor(a, id); }
}
