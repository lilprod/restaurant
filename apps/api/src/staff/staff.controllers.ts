import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  AbsenceDecisionInput, AbsenceInput, AttendanceCorrectionInput, AttendanceCreateInput, CopyWeekInput, KioskCodeInput, KioskPunchInput, ListAttendanceQuery,
  PeriodQuery, PublishWeekInput, ShiftInput, ShiftUpdate, StaffProfileInput,
  absenceDecisionSchema, absenceInputSchema, attendanceCorrectionSchema, attendanceCreateSchema, copyWeekSchema, kioskCodeSchema, kioskPunchSchema,
  balanceQuerySchema, emptyBodySchema, listAbsencesQuerySchema, listAttendanceQuerySchema, periodQuerySchema, planningQuerySchema, publishWeekSchema, punchSchema, shiftInputSchema, shiftUpdateSchema,
  staffProfileInputSchema,
} from "@restaurant/validation";
import type { PunchAction } from "@restaurant/validation";
import { ZodPipe } from "../common/zod.pipe";
import { MANAGERS, STAFF } from "../restaurant/common";
import { Account } from "../security/accounts.repo";
import { CurrentAccount } from "../security/space-auth.guard";
import { PlanFeature, PlanFeatureGuard } from "../tenant/plan-feature.guard";
import { TenantAuthGuard, TenantRoles } from "../tenant/tenant-auth.guard";
import { AbsencesService } from "./absences.service";
import { AttendanceService } from "./attendance.service";
import { PlanningService } from "./planning.service";
import { ProfilesService } from "./profiles.service";
import { StaffReportsService } from "./reports.service";

const t = (a: Account) => a.tenantId!;
const UUID = new ParseUUIDPipe();

/**
 * P4 — Personnel : fiches, planning, pointage, absences, performances, paie. Module `staff` du plan (sinon `403 PLAN_FEATURE`).
 * Lecture de son propre planning, pointage et demandes d'absence : tout le personnel ; le reste : responsables ; paie : administrateur.
 */
@ApiTags("Restaurant · Personnel")
@ApiBearerAuth()
@UseGuards(TenantAuthGuard, PlanFeatureGuard)
@PlanFeature("staff")
@TenantRoles(...MANAGERS)
@Controller("tenant/staff")
export class StaffHrController {
  constructor(
    private readonly profiles: ProfilesService, private readonly planning: PlanningService, private readonly attendance: AttendanceService,
    private readonly absences: AbsencesService, private readonly reports: StaffReportsService,
  ) {}

  // ── Fiches ──
  @Get("profiles") listProfiles(@CurrentAccount() a: Account) { return this.profiles.list(a); }
  @Get("profiles/:userId") profile(@CurrentAccount() a: Account, @Param("userId", UUID) id: string) { return this.profiles.get(a, id); }
  @Put("profiles/:userId")
  saveProfile(@CurrentAccount() a: Account, @Param("userId", UUID) id: string, @Body(new ZodPipe(staffProfileInputSchema)) body: StaffProfileInput) { return this.profiles.upsert(a, id, body); }
  @Put("profiles/:userId/kiosk-code") @HttpCode(200)
  setCode(@CurrentAccount() a: Account, @Param("userId", UUID) id: string, @Body(new ZodPipe(kioskCodeSchema)) body: KioskCodeInput) { return this.profiles.setKioskCode(a, id, body); }
  @Delete("profiles/:userId/kiosk-code") removeCode(@CurrentAccount() a: Account, @Param("userId", UUID) id: string) { return this.profiles.clearKioskCode(a, id); }
  @Post("profiles/:userId/kiosk-unlock") @HttpCode(200) unlock(@CurrentAccount() a: Account, @Param("userId", UUID) id: string, @Body(new ZodPipe(emptyBodySchema)) _body: object) { return this.profiles.unlockKiosk(a, id); }

  // ── Mon espace (tout le personnel) ──
  @Get("me") @TenantRoles(...STAFF) me(@CurrentAccount() a: Account) { return this.profiles.mine(a); }
  @Get("me/attendance") @TenantRoles(...STAFF) myAttendance(@CurrentAccount() a: Account) { return this.attendance.me(a); }
  @Post("me/punch") @HttpCode(200) @TenantRoles(...STAFF)
  punch(@CurrentAccount() a: Account, @Body(new ZodPipe(punchSchema)) body: { action: PunchAction }) { return this.attendance.punch(a, body.action); }
  @Get("planning/mine") @TenantRoles(...STAFF)
  myPlanning(@CurrentAccount() a: Account, @Query(new ZodPipe(planningQuerySchema)) q: { week?: string }) { return this.planning.week(t(a), q.week, a.id); }
  @Get("absences") @TenantRoles(...STAFF)
  listAbsences(@CurrentAccount() a: Account, @Query(new ZodPipe(listAbsencesQuerySchema)) q: { status?: "PENDING" | "APPROVED" | "REJECTED"; mine?: string }) { return this.absences.list(a, q); }
  @Get("absences/balance") @TenantRoles(...STAFF)
  balance(@CurrentAccount() a: Account, @Query(new ZodPipe(balanceQuerySchema)) q: { userId?: string; year?: number }) { return this.absences.balance(a, q.userId, q.year); }
  @Post("absences") @TenantRoles(...STAFF)
  requestAbsence(@CurrentAccount() a: Account, @Body(new ZodPipe(absenceInputSchema)) body: AbsenceInput) { return this.absences.create(a, body); }
  @Delete("absences/:id") @TenantRoles(...STAFF) cancelAbsence(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.absences.cancel(a, id); }
  @Post("absences/:id/decision") @HttpCode(200)
  decide(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(absenceDecisionSchema)) body: AbsenceDecisionInput) { return this.absences.decide(a, id, body); }

  // ── Tablette commune ──
  @Get("kiosk") @TenantRoles(...STAFF) kioskPeople(@CurrentAccount() a: Account) { return this.attendance.kioskPeople(t(a)); }
  @Post("kiosk/punch") @HttpCode(200) @TenantRoles(...STAFF)
  kioskPunch(@CurrentAccount() a: Account, @Body(new ZodPipe(kioskPunchSchema)) body: KioskPunchInput) { return this.attendance.kioskPunch(a, body); }

  // ── Planning (responsables) ──
  @Get("planning") week(@CurrentAccount() a: Account, @Query(new ZodPipe(planningQuerySchema)) q: { week?: string }) { return this.planning.week(t(a), q.week); }
  @Post("shifts") createShift(@CurrentAccount() a: Account, @Body(new ZodPipe(shiftInputSchema)) body: ShiftInput) { return this.planning.create(a, body); }
  @Patch("shifts/:id")
  updateShift(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(shiftUpdateSchema)) body: ShiftUpdate) { return this.planning.update(a, id, body); }
  @Delete("shifts/:id") removeShift(@CurrentAccount() a: Account, @Param("id", UUID) id: string) { return this.planning.remove(a, id); }
  @Post("planning/copy") @HttpCode(200) copy(@CurrentAccount() a: Account, @Body(new ZodPipe(copyWeekSchema)) body: CopyWeekInput) { return this.planning.copyWeek(a, body); }
  @Post("planning/publish") @HttpCode(200) publish(@CurrentAccount() a: Account, @Body(new ZodPipe(publishWeekSchema)) body: PublishWeekInput) { return this.planning.publish(a, body); }

  // ── Pointages (responsables) ──
  @Get("attendance") listAttendance(@CurrentAccount() a: Account, @Query(new ZodPipe(listAttendanceQuerySchema)) q: ListAttendanceQuery) { return this.attendance.list(t(a), q); }
  @Get("attendance/present") present(@CurrentAccount() a: Account) { return this.attendance.present(t(a)); }
  @Post("attendance") createAttendance(@CurrentAccount() a: Account, @Body(new ZodPipe(attendanceCreateSchema)) body: AttendanceCreateInput) { return this.attendance.create(a, body); }
  @Patch("attendance/:id")
  correct(@CurrentAccount() a: Account, @Param("id", UUID) id: string, @Body(new ZodPipe(attendanceCorrectionSchema)) body: AttendanceCorrectionInput) { return this.attendance.correct(a, id, body); }

  // ── Performances et paie ──
  @Get("performance") performance(@CurrentAccount() a: Account, @Query(new ZodPipe(periodQuerySchema)) q: PeriodQuery) { return this.reports.performance(t(a), q); }
  @Get("payroll") @TenantRoles("ADMIN") payroll(@CurrentAccount() a: Account, @Query(new ZodPipe(periodQuerySchema)) q: PeriodQuery) { return this.reports.payroll(t(a), q); }
  @Get("payroll/export") @TenantRoles("ADMIN")
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", 'attachment; filename="paie.csv"') @Header("Cache-Control", "no-store")
  payrollCsv(@CurrentAccount() a: Account, @Query(new ZodPipe(periodQuerySchema)) q: PeriodQuery) { return this.reports.payrollCsv(t(a), q); }
}
