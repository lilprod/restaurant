import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  AvailabilityQuery, CancelReservationInput, ClosureInput, ConvertWaitlistInput, CreateReservationInput, ListClosuresQuery,
  ListReservationsQuery, ListWaitlistQuery, OpeningHoursInput, PublicAvailabilityQuery, PublicReservationInput,
  PublicUpdateReservationInput, UpdateReservationInput, WaitlistInput,
  availabilityQuerySchema, cancelReservationSchema, closureInputSchema, convertWaitlistSchema, createReservationSchema,
  listClosuresQuerySchema, listReservationsQuerySchema, listWaitlistQuerySchema, openingHoursSchema, publicAvailabilityQuerySchema,
  publicReservationSchema, publicUpdateReservationSchema, updateReservationSchema, waitlistInputSchema,
} from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { FLOOR, MANAGERS, STAFF } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { ReservationsService } from "./reservations.service";
import { ScheduleService } from "./schedule.service";
import { WaitlistService } from "./waitlist.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();

/** Lecture : tout le personnel ; écriture : salle (forçage : responsables). */
@ApiTags("Restaurant · Réservations")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant/reservations")
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get() list(@CurrentAccount() a: Account, @Query(new ZodPipe(listReservationsQuerySchema)) q: ListReservationsQuery) { return this.reservations.list(t(a), q); }

  @Get("availability") @ApiOperation({ summary: "Créneaux d'une journée avec tables proposées" })
  availability(@CurrentAccount() a: Account, @Query(new ZodPipe(availabilityQuerySchema)) q: AvailabilityQuery) { return this.reservations.availability(t(a), q); }

  @Get(":id") get(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.get(t(a), id); }

  @Get(":id/waitlist-matches") @TenantRoles(...FLOOR)
  matches(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.waitlistMatches(t(a), id); }

  @Post() @TenantRoles(...FLOOR)
  create(@CurrentAccount() a: Account, @Body(new ZodPipe(createReservationSchema)) body: CreateReservationInput) { return this.reservations.create(a, body); }

  @Patch(":id") @TenantRoles(...FLOOR)
  update(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(updateReservationSchema)) body: UpdateReservationInput) {
    return this.reservations.update(a, id, body);
  }

  @Post(":id/confirm") @HttpCode(200) @TenantRoles(...FLOOR)
  confirm(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.confirm(a, id); }

  @Post(":id/seat") @HttpCode(200) @TenantRoles(...FLOOR)
  seat(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.seat(a, id); }

  @Post(":id/complete") @HttpCode(200) @TenantRoles(...FLOOR)
  complete(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.complete(a, id); }

  @Post(":id/cancel") @HttpCode(200) @TenantRoles(...FLOOR)
  cancel(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(cancelReservationSchema)) body: CancelReservationInput) {
    return this.reservations.cancel(a, t(a), id, body);
  }

  @Post(":id/no-show") @HttpCode(200) @TenantRoles(...FLOOR)
  noShow(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.reservations.noShow(a, id); }
}

@ApiTags("Restaurant · Réservations")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...STAFF)
@Controller("tenant")
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  @Get("opening-hours") hours(@CurrentAccount() a: Account) { return this.schedule.hours(t(a)); }

  @Put("opening-hours") @TenantRoles(...MANAGERS)
  setHours(@CurrentAccount() a: Account, @Body(new ZodPipe(openingHoursSchema)) body: OpeningHoursInput) { return this.schedule.setHours(a, body); }

  @Get("closures") closures(@CurrentAccount() a: Account, @Query(new ZodPipe(listClosuresQuerySchema)) q: ListClosuresQuery) { return this.schedule.closures(t(a), q); }

  @Post("closures") @TenantRoles(...MANAGERS)
  addClosure(@CurrentAccount() a: Account, @Body(new ZodPipe(closureInputSchema)) body: ClosureInput) { return this.schedule.addClosure(a, body); }

  @Delete("closures/:id") @HttpCode(204) @TenantRoles(...MANAGERS)
  removeClosure(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.schedule.removeClosure(a, id); }
}

@ApiTags("Restaurant · Réservations")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard)
@TenantRoles(...FLOOR)
@Controller("tenant/waitlist")
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get() list(@CurrentAccount() a: Account, @Query(new ZodPipe(listWaitlistQuerySchema)) q: ListWaitlistQuery) { return this.waitlist.list(t(a), q); }
  @Post() create(@CurrentAccount() a: Account, @Body(new ZodPipe(waitlistInputSchema)) body: WaitlistInput) { return this.waitlist.create(a, body); }
  @Post(":id/notify") @HttpCode(200) notify(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.waitlist.notify(a, id); }
  @Post(":id/convert") @HttpCode(201)
  convert(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(convertWaitlistSchema)) body: ConvertWaitlistInput) {
    return this.waitlist.convert(a, id, body);
  }
  @Post(":id/remove") @HttpCode(200) remove(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.waitlist.remove(a, id); }
}

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const token = (v: string) => { if (!TOKEN.test(v)) throw new NotFoundException("Réservation introuvable"); return v; };

/** Réservation en ligne sans compte (limitée en débit par IP). */
@ApiTags("Public · Réservations")
@Controller("public")
export class PublicReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get("tenants/:slug/availability") @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Créneaux disponibles (réservation en ligne)" })
  availability(@Param("slug") slug: string, @Query(new ZodPipe(publicAvailabilityQuerySchema)) q: PublicAvailabilityQuery) {
    return this.reservations.publicAvailability(slug, q);
  }

  @Post("tenants/:slug/reservations") @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: "Réserver sans compte : renvoie le code et le lien de gestion" })
  create(@Param("slug") slug: string, @Body(new ZodPipe(publicReservationSchema)) body: PublicReservationInput) {
    return this.reservations.publicCreate(slug, body);
  }

  @Get("reservations/:token") @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Param("token") tk: string) { return this.reservations.publicGet(token(tk)); }

  @Patch("reservations/:token") @Throttle({ default: { limit: 10, ttl: 60_000 } })
  update(@Param("token") tk: string, @Body(new ZodPipe(publicUpdateReservationSchema)) body: PublicUpdateReservationInput) {
    return this.reservations.publicUpdate(token(tk), body);
  }

  @Delete("reservations/:token") @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(@Param("token") tk: string) { return this.reservations.publicCancel(token(tk)); }
}
