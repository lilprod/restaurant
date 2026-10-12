import type {
  BrandingInput, BusinessInput, CompanyInput, CreateTenantInput, LicensingSettings, LocalizationInput, OperationsInput,
  PaymentInstructionsInput, PlanInput, PlatformSecurityInput, RecordPaymentInput, RegistrationInput, TenantSecurityInput,
} from "@restaurant/validation";
import type { ApiClient } from "./client";
import type {
  AccountSummary, AssetKind, BrandingSettings, LoginEvent, LoginResponse, LoginResult, LoginSuccess, Paginated, PaymentList,
  Plan, PlatformDashboard, PlatformPublicBranding, PlatformRole, PlatformSettingsAll, PlatformUserView, Profile, PublicPlan, Receipt,
  RecordPaymentResult, Registration, RegistrationStatus, SessionRow, SubscriptionWithPayments, Tenant, TenantDetail, TenantLicense,
  TenantListItem, TenantPublicBranding, TenantSettingsAll, TenantStatus, TenantUserSecurity, TwoFactorSetup,
} from "./types";

const enc = encodeURIComponent;

/** Authentification (routes identiques dans les deux espaces). */
export function authApi(c: ApiClient) {
  const p = `/${c.space}/auth`;
  return {
    login: (body: { email: string; password: string; tenantSlug?: string }) => c.post<LoginResponse>(`${p}/login`, body, { auth: false }),
    verify2fa: (body: { challengeToken: string; code: string }) => c.post<LoginSuccess>(`${p}/2fa/verify`, body, { auth: false }),
    forgotPassword: (body: { email: string; tenantSlug?: string }) => c.post<{ message: string }>(`${p}/forgot-password`, body, { auth: false }),
    resetPassword: (body: { token: string; newPassword: string }) => c.post<{ ok: true }>(`${p}/reset-password`, body, { auth: false }),
  };
}

/** « Mon compte ». */
export function accountApi(c: ApiClient) {
  const p = `/${c.space}/account`;
  return {
    me: () => c.get<Profile>(`${p}/me`),
    updateProfile: (body: { firstName?: string; lastName?: string; phone?: string; locale?: "fr" | "en" }) => c.patch<Profile>(`${p}/profile`, body),
    uploadAvatar: (file: Blob) => c.upload<{ avatarUrl: string }>(`${p}/avatar`, file),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      c.post<{ ok: true; reloginRequired: boolean }>(`${p}/change-password`, body),
    sessions: () => c.get<SessionRow[]>(`${p}/sessions`),
    revokeSession: (id: string) => c.delete<void>(`${p}/sessions/${enc(id)}`),
    revokeOtherSessions: () => c.delete<{ revoked: number }>(`${p}/sessions`),
    setup2fa: () => c.post<TwoFactorSetup>(`${p}/2fa/setup`),
    enable2fa: (code: string) => c.post<{ enabled: true; recoveryCodes: string[] }>(`${p}/2fa/enable`, { code }),
    disable2fa: (body: { password: string; code?: string }) => c.post<{ enabled: false }>(`${p}/2fa/disable`, body),
    regenerateRecoveryCodes: (body: { password: string; code?: string }) => c.post<{ recoveryCodes: string[] }>(`${p}/2fa/recovery-codes`, body),
    loginHistory: () => c.get<LoginEvent[]>(`${p}/login-history`),
  };
}

/** Routes publiques (sans authentification). */
export function publicApi(c: ApiClient) {
  return {
    plans: () => c.get<PublicPlan[]>("/public/plans", { auth: false }),
    register: (body: RegistrationInput) => c.post<{ id: string; status: string; message: string }>("/public/registrations", body, { auth: false }),
    platformBranding: () => c.get<PlatformPublicBranding>("/public/branding", { auth: false }),
    tenantBranding: (slug: string) => c.get<TenantPublicBranding>(`/public/tenants/${enc(slug)}/branding`, { auth: false }),
  };
}

type Section<T> = T;
type SettingsSectionMap = {
  business: Section<BusinessInput>;
  branding: Section<BrandingSettings>;
  operations: Section<OperationsInput>;
  localization: Section<LocalizationInput>;
  security: Section<TenantSecurityInput>;
};
type PlatformSectionMap = {
  branding: Section<BrandingSettings>;
  company: Section<CompanyInput>;
  localization: Section<LocalizationInput>;
  security: Section<PlatformSecurityInput>;
  paymentInstructions: Section<PaymentInstructionsInput>;
  licensing: Section<LicensingSettings>;
};
export type TenantSection = keyof SettingsSectionMap;
export type PlatformSection = keyof PlatformSectionMap;
export type { SettingsSectionMap as TenantSectionMap, PlatformSectionMap };

/** Patch partiel d'une section de réglages (fusion profonde côté API). */
export type SectionPatch<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : SectionPatch<T[K]>) : T[K] | "" };

export interface LoginEventsQuery { limit?: number; result?: LoginResult; space?: "platform" | "tenant"; tenantId?: string }

/** Espace SuperAdmin. */
export function platformApi(c: ApiClient) {
  const tenantAdmin = (id: string) => `/platform/tenants/${enc(id)}`;
  return {
    dashboard: () => c.get<PlatformDashboard>("/platform/dashboard"),
    sweepLicenses: () => c.post<{ checked: number; changed: number }>("/platform/licensing/sweep"),

    plans: {
      list: () => c.get<Plan[]>("/platform/plans"),
      get: (id: string) => c.get<Plan>(`/platform/plans/${enc(id)}`),
      create: (body: PlanInput) => c.post<Plan>("/platform/plans", body),
      update: (id: string, body: Partial<PlanInput>) => c.patch<Plan>(`/platform/plans/${enc(id)}`, body),
    },

    tenants: {
      list: (q: { status?: TenantStatus; search?: string; page?: number; pageSize?: number } = {}) =>
        c.get<Paginated<TenantListItem>>("/platform/tenants", { query: q }),
      create: (body: CreateTenantInput) => c.post<TenantDetail>("/platform/tenants", body),
      get: (id: string) => c.get<TenantDetail>(tenantAdmin(id)),
      update: (id: string, body: { name?: string; email?: string; phone?: string; address?: string }) => c.patch<Tenant>(tenantAdmin(id), body),
      subscriptions: (id: string) => c.get<SubscriptionWithPayments[]>(`${tenantAdmin(id)}/subscriptions`),
      suspend: (id: string) => c.post<Tenant>(`${tenantAdmin(id)}/suspend`),
      reactivate: (id: string) => c.post<Tenant>(`${tenantAdmin(id)}/reactivate`),
      // Support (SUPER_ADMIN) : réglages et comptes du restaurant
      settings: (id: string) => c.get<TenantSettingsAll>(`${tenantAdmin(id)}/settings`),
      getSection: <S extends TenantSection>(id: string, s: S) => c.get<SettingsSectionMap[S]>(`${tenantAdmin(id)}/settings/${s}`),
      updateSection: <S extends TenantSection>(id: string, s: S, body: SectionPatch<SettingsSectionMap[S]> | BrandingInput) =>
        c.patch<SettingsSectionMap[S]>(`${tenantAdmin(id)}/settings/${s}`, body),
      uploadAsset: (id: string, kind: AssetKind, file: Blob) => c.upload<{ kind: AssetKind; url: string }>(`${tenantAdmin(id)}/assets/${kind}`, file),
      removeAsset: (id: string, kind: AssetKind) => c.delete<void>(`${tenantAdmin(id)}/assets/${kind}`),
      users: (id: string) => c.get<TenantUserSecurity[]>(`${tenantAdmin(id)}/security/users`),
      loginEvents: (id: string, q: LoginEventsQuery = {}) => c.get<LoginEvent[]>(`${tenantAdmin(id)}/security/login-events`, { query: { ...q } }),
      userAction: (id: string, userId: string, action: "reset-password" | "unlock" | "disable-2fa" | "revoke-sessions") =>
        c.post<{ temporaryPassword?: string; ok?: boolean; revoked?: number }>(`${tenantAdmin(id)}/security/users/${enc(userId)}/${action}`),
    },

    registrations: {
      list: (status?: RegistrationStatus) => c.get<Registration[]>("/platform/registrations", { query: { status } }),
      approve: (id: string, planId?: string) =>
        c.post<{ registrationId: string; tenantId: string; slug: string; status: TenantStatus }>(`/platform/registrations/${enc(id)}/approve`, planId ? { planId } : {}),
      reject: (id: string, reason: string) => c.post<{ id: string; status: "REJECTED" }>(`/platform/registrations/${enc(id)}/reject`, { reason }),
    },

    payments: {
      list: (q: { tenantId?: string; method?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
        c.get<PaymentList>("/platform/payments", { query: q }),
      get: (id: string) => c.get<Receipt>(`/platform/payments/${enc(id)}`),
      record: (body: RecordPaymentInput) => c.post<RecordPaymentResult>("/platform/payments", body),
      void: (id: string, reason: string) => c.post<Receipt>(`/platform/payments/${enc(id)}/void`, { reason }),
    },

    settings: {
      all: () => c.get<PlatformSettingsAll>("/platform/settings"),
      get: <S extends PlatformSection>(s: S) => c.get<PlatformSectionMap[S]>(`/platform/settings/${s}`),
      update: <S extends PlatformSection>(s: S, body: SectionPatch<PlatformSectionMap[S]> | BrandingInput) =>
        c.patch<PlatformSectionMap[S]>(`/platform/settings/${s}`, body),
      uploadAsset: (kind: AssetKind, file: Blob) => c.upload<{ kind: AssetKind; url: string }>(`/platform/settings/assets/${kind}`, file),
      removeAsset: (kind: AssetKind) => c.delete<void>(`/platform/settings/assets/${kind}`),
    },

    users: {
      list: () => c.get<PlatformUserView[]>("/platform/users"),
      create: (body: { email: string; firstName: string; lastName: string; role: PlatformRole }) =>
        c.post<PlatformUserView & { temporaryPassword: string }>("/platform/users", body),
      update: (id: string, body: { role?: PlatformRole; isActive?: boolean }) => c.patch<PlatformUserView>(`/platform/users/${enc(id)}`, body),
      action: (id: string, action: "reset-password" | "unlock" | "disable-2fa" | "revoke-sessions") =>
        c.post<{ temporaryPassword?: string; ok?: boolean; revoked?: number }>(`/platform/users/${enc(id)}/${action}`),
    },

    security: {
      loginEvents: (q: LoginEventsQuery = {}) => c.get<LoginEvent[]>("/platform/security/login-events", { query: { ...q } }),
    },
  };
}

/** Espace d'un restaurant. */
export function tenantApi(c: ApiClient) {
  return {
    settings: {
      all: () => c.get<TenantSettingsAll>("/tenant/settings"),
      get: <S extends TenantSection>(s: S) => c.get<SettingsSectionMap[S]>(`/tenant/settings/${s}`),
      update: <S extends TenantSection>(s: S, body: SectionPatch<SettingsSectionMap[S]> | BrandingInput) =>
        c.patch<SettingsSectionMap[S]>(`/tenant/settings/${s}`, body),
      uploadAsset: (kind: AssetKind, file: Blob) => c.upload<{ kind: AssetKind; url: string }>(`/tenant/settings/assets/${kind}`, file),
      removeAsset: (kind: AssetKind) => c.delete<void>(`/tenant/settings/assets/${kind}`),
    },
    security: {
      users: () => c.get<TenantUserSecurity[]>("/tenant/security/users"),
      loginEvents: (q: { limit?: number } = {}) => c.get<LoginEvent[]>("/tenant/security/login-events", { query: { ...q } }),
      userAction: (userId: string, action: "reset-password" | "unlock" | "disable-2fa" | "revoke-sessions") =>
        c.post<{ temporaryPassword?: string; ok?: boolean; revoked?: number }>(`/tenant/security/users/${enc(userId)}/${action}`),
      setActive: (userId: string, isActive: boolean) => c.patch<{ ok: true; isActive: boolean }>(`/tenant/security/users/${enc(userId)}/active`, { isActive }),
    },
    license: () => c.get<TenantLicense>("/tenant/license"),
  };
}

export type AuthApi = ReturnType<typeof authApi>;
export type AccountApi = ReturnType<typeof accountApi>;
export type PublicApi = ReturnType<typeof publicApi>;
export type PlatformApi = ReturnType<typeof platformApi>;
export type TenantApi = ReturnType<typeof tenantApi>;
export type { AccountSummary };
