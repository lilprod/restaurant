import { DEFAULT_PASSWORD_POLICY, DEFAULT_THEME } from "@restaurant/utils";
import type { LocalizationInput, OperationsInput, PaymentInstructionsInput, PlatformSecurityInput, TenantSecurityInput } from "@restaurant/validation";

export const DEFAULT_TENANT_SECURITY: TenantSecurityInput = {
  passwordPolicy: { ...DEFAULT_PASSWORD_POLICY },
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  sessionDays: 30,
  passwordExpiryDays: 0,
  require2faRoles: [],
};

export const DEFAULT_PLATFORM_SECURITY: PlatformSecurityInput = {
  passwordPolicy: { ...DEFAULT_PASSWORD_POLICY, minLength: 12, requireSymbol: true },
  maxFailedAttempts: 5,
  lockoutMinutes: 30,
  sessionDays: 14,
  passwordExpiryDays: 0,
  require2fa: false,
};

export const DEFAULT_OPERATIONS: OperationsInput = {
  defaultVatRate: 18,
  serviceChargePercent: 0,
  tipsEnabled: true,
  tipPresets: [5, 10, 15],
  onlineReservations: true,
  reservationDurationMinutes: 90,
  reservationSlotMinutes: 15,
  maxPartySize: 20,
  takeawayEnabled: true,
  deliveryEnabled: false,
};

export const DEFAULT_LOCALIZATION: LocalizationInput = {
  locale: "fr",
  timezone: "Africa/Lome",
  dateFormat: "DD/MM/YYYY",
  firstDayOfWeek: 1,
};

export const DEFAULT_PAYMENT_INSTRUCTIONS: PaymentInstructionsInput = { flooz: {}, tmoney: {}, bank: {} };

export const DEFAULT_LICENSING = { graceDays: 7 };

export const defaultBranding = (displayName: string) => ({ displayName, theme: { ...DEFAULT_THEME } });
