import { Injectable } from "@nestjs/common";
import { TenantSettingsService } from "../settings/tenant-settings.service";

/** Date seule (embauche, fin de contrat) stockée à minuit UTC. */
export const dayToDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const dateToDay = (d: Date) => d.toISOString().slice(0, 10);

export const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/** Heure locale « HH:MM » dans le fuseau du restaurant. */
export const hhmm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** Contexte du restaurant utile au personnel : fuseau, premier jour de semaine, seuil d'heures supplémentaires, congés. */
@Injectable()
export class StaffContext {
  constructor(private readonly settings: TenantSettingsService) {}

  async get(tenantId: string) {
    const t = await this.settings.tenant(tenantId);
    const [loc, staff] = await Promise.all([this.settings.getSection("localization", t), this.settings.getSection("staff", t)]);
    return {
      tz: t.timezone as string,
      firstDay: (loc?.firstDayOfWeek ?? 1) as number,
      thresholdMinutes: Math.round((staff?.overtimeThresholdHours ?? 40) * 60),
      leaveDaysPerYear: (staff?.leaveDaysPerYear ?? 24) as number,
      restaurantName: t.name as string,
    };
  }
}
export type StaffCtx = Awaited<ReturnType<StaffContext["get"]>>;
