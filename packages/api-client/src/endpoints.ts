import type {
  BrandingInput, BusinessInput, CategoryInput, CompanyInput, CreateOrderInput, CreateStaffInput, CreateTenantInput, LicensingSettings,
  FormulaInput, FormulaUpdateInput, LocalizationInput, MenuItemInput, PromotionInput, NotificationsSettingsInput, OperationsInput, OrderItemInput, OrderPaymentInput, PaymentInstructionsInput, PlanInput,
  PlatformSecurityInput, RecordPaymentInput, RegistrationInput, TableInput, TenantSecurityInput,
  CreateStockCountInput, IngredientInput, IngredientUpdate, PurchaseOrderInput, PurchaseOrderUpdate, ReceivePurchaseInput, RecipeInput,
  StockAdjustInput, StockCountLinesInput, SupplierInput, SupplierUpdate, WasteInput,
  CancelReservationInput, ClosureInput, ConvertWaitlistInput, CreateReservationInput, OpeningHoursInput, PublicReservationInput,
  PublicUpdateReservationInput, ReservationsSettingsInput, UpdateReservationInput, WaitlistInput,
  AbsenceDecisionInput, AbsenceInput, AttendanceCorrectionInput, AttendanceCreateInput, CopyWeekInput, KioskCodeInput, KioskPunchInput, PublishWeekInput,
  ShiftInput, ShiftUpdate, StaffProfileInput, StaffSettingsInput,
  CompleteDeliveryInput, DeliveryZoneInput, DeliveryZoneUpdate,
  CustomerProfileInput, CustomerSignupInput, ListReviewsQuery, NotificationPrefs, ReviewInput,
} from "@restaurant/validation";
import type { ApiClient } from "./client";
import type {
  AuditLogList, AuditLogQueryParams,
  AccountSummary, Allergen, AssetKind, NotificationList, NotificationsQuery, BrandingSettings, DiningTable, FloorPlan, TableLayoutEntry, LoginEvent, MenuCategory, MenuItem, Order, OrderItemStatus,
  OrderPaymentResult, OrderReceipt, OrdersQuery, PublicMenu, RegisterCloseResult, RegisterCurrent, RegisterSession, StaffMember,
  StaffRole, TableStatus, TenantDashboard, LoginResponse, LoginResult, LoginSuccess, Paginated, PaymentList,
  Plan, PlatformDashboard, PlatformPublicBranding, PlatformRole, PlatformSettingsAll, PlatformUserView, Profile, PublicPlan, Receipt,
  RecordPaymentResult, Registration, RegistrationStatus, SessionRow, SubscriptionWithPayments, Tenant, TenantDetail, TenantLicense,
  TenantListItem, TenantPublicBranding, TenantSettingsAll, TenantStatus, TenantUserSecurity, TwoFactorSetup,
  DishCost, DishRecipe, Ingredient, IngredientsQuery, MovementsQuery, OptionRecipe, PurchaseOrder, PurchaseStatus, StockAlert,
  StockCount, StockCountSummary, StockMovement, Supplier, WasteList, WasteRecord,
  Formula, Promotion,
  Availability, CancelledReservation, ClosureCreated, ClosureDay, OpeningRange, PublicAvailability, PublicReservation,
  PublicReservationCreated, Reservation, ReservationsQuery, WaitlistEntry, WaitlistStatus,
  Attendance, ChatChannel, ChatMessage, KioskPerson, LeaveBalance, MyAttendance, Payroll, Performance, PlanningAbsence, Planning, Shift, StaffFile,
  AbsenceStatus, PunchAction,
  LicensesReport, MarginsReport, PeakHoursReport, RegisterReport, ReportKind, ReportsSettings, ReviewsReport, SalesReport, VatReport, WasteReport,
  Delivery, DeliveryBoard, DeliveryDriver, DeliverySettleResult, DeliverySettlements, DeliveryZone,
  CustomerExport, CustomerOrder, CustomerProfile, CustomerReservation, OrderTracking, PublicReviews, Review, ReviewStats,
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
    /** Carte publique d'un restaurant (catégories actives, plats disponibles). */
    tenantMenu: (slug: string) => c.get<PublicMenu>(`/public/tenants/${enc(slug)}/menu`, { auth: false }),
    // ── P2A : réservation en ligne sans compte (limitée en débit) ──
    availability: (slug: string, q: { date: string; partySize: number }) =>
      c.get<PublicAvailability>(`/public/tenants/${enc(slug)}/availability`, { auth: false, query: { date: q.date, partySize: String(q.partySize) } }),
    reserve: (slug: string, body: PublicReservationInput) => c.post<PublicReservationCreated>(`/public/tenants/${enc(slug)}/reservations`, body, { auth: false }),
    /** Créneaux pour modifier sa réservation : elle ne compte pas comme occupée. */
    reservationAvailability: (token: string, q: { date: string; partySize: number }) =>
      c.get<PublicAvailability>(`/public/reservations/${enc(token)}/availability`, { auth: false, query: { date: q.date, partySize: String(q.partySize) } }),
    reservation: (token: string) => c.get<PublicReservation>(`/public/reservations/${enc(token)}`, { auth: false }),
    updateReservation: (token: string, body: PublicUpdateReservationInput) => c.patch<PublicReservation>(`/public/reservations/${enc(token)}`, body, { auth: false }),
    cancelReservation: (token: string) => c.delete<PublicReservation>(`/public/reservations/${enc(token)}`, { auth: false }),
    // ── P2C : espace client (sans compte) ──
    signup: (slug: string, body: CustomerSignupInput) => c.post<{ id: string; email: string; emailVerificationSent: boolean }>(`/public/tenants/${enc(slug)}/customers`, body, { auth: false }),
    /** Statut d'une commande par le lien du ticket (à interroger régulièrement). */
    tracking: (token: string) => c.get<OrderTracking>(`/public/tracking/${enc(token)}`, { auth: false }),
    trackingReview: (token: string, body: ReviewInput) => c.post<OrderTracking>(`/public/tracking/${enc(token)}/review`, body, { auth: false }),
    reviews: (slug: string, q: { page?: number; pageSize?: number } = {}) =>
      c.get<PublicReviews>(`/public/tenants/${enc(slug)}/reviews`, { auth: false, query: { ...(q.page ? { page: String(q.page) } : {}), ...(q.pageSize ? { pageSize: String(q.pageSize) } : {}) } }),
  };
}

/** Espace du client connecté (jeton du restaurant, rôle CUSTOMER). */
export function customerApi(c: ApiClient) {
  const p = "/tenant/customer";
  return {
    profile: () => c.get<CustomerProfile>(`${p}/profile`),
    updateProfile: (body: CustomerProfileInput) => c.patch<CustomerProfile>(`${p}/profile`, body),
    setPreferences: (body: NotificationPrefs) => c.put<CustomerProfile>(`${p}/notification-prefs`, body),
    sendVerification: () => c.post<{ alreadyVerified: boolean; sent?: boolean }>(`${p}/verify-email/send`),
    verifyEmail: (code: string) => c.post<{ verified: true; reservationsLinked: number }>(`${p}/verify-email`, { code }),
    export: () => c.get<CustomerExport>(`${p}/export`),
    deleteAccount: (password: string) => c.post<{ deleted: true }>(`${p}/delete`, { password }),
    reservations: () => c.get<CustomerReservation[]>(`${p}/reservations`),
    reservationAvailability: (id: string, q: { date: string; partySize: number }) =>
      c.get<PublicAvailability>(`${p}/reservations/${enc(id)}/availability`, { query: { date: q.date, partySize: String(q.partySize) } }),
    updateReservation: (id: string, body: PublicUpdateReservationInput) => c.patch<CustomerReservation>(`${p}/reservations/${enc(id)}`, body),
    cancelReservation: (id: string) => c.post<CustomerReservation>(`${p}/reservations/${enc(id)}/cancel`),
    orders: () => c.get<CustomerOrder[]>(`${p}/orders`),
    claimOrder: (token: string) => c.post<{ orderId: string; number: number }>(`${p}/orders/claim`, { token }),
    reviewOrder: (orderId: string, body: ReviewInput) => c.post<CustomerOrder>(`${p}/orders/${enc(orderId)}/review`, body),
  };
}

type Section<T> = T;
type SettingsSectionMap = {
  business: Section<BusinessInput>;
  branding: Section<BrandingSettings>;
  operations: Section<OperationsInput>;
  localization: Section<LocalizationInput>;
  security: Section<TenantSecurityInput>;
  notifications: Section<NotificationsSettingsInput>;
  reservations: Section<ReservationsSettingsInput>;
  staff: Section<StaffSettingsInput>;
  reports: ReportsSettings;
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
    reports: {
      licenses: (q: { from: string; to: string }) => c.get<LicensesReport>("/platform/reports/licenses", { query: q }),
      download: (q: { from: string; to: string }, format: "csv" | "pdf") => c.download("/platform/reports/licenses/export", { ...q, format }),
    },
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
      setUserActive: (id: string, userId: string, isActive: boolean) =>
        c.patch<{ ok: true; isActive: boolean }>(`${tenantAdmin(id)}/security/users/${enc(userId)}/active`, { isActive }),
    },

    registrations: {
      list: (status?: RegistrationStatus) => c.get<Registration[]>("/platform/registrations", { query: { status } }),
      approve: (id: string, planId?: string) =>
        c.post<{ registrationId: string; tenantId: string; slug: string; status: TenantStatus }>(`/platform/registrations/${enc(id)}/approve`, planId ? { planId } : {}),
      reject: (id: string, reason: string) => c.post<{ id: string; status: "REJECTED" }>(`/platform/registrations/${enc(id)}/reject`, { reason }),
    },

    auditLogs: {
      list: (q: AuditLogQueryParams = {}) => c.get<AuditLogList>("/platform/audit-logs", { query: { ...q } }),
      tenant: (tenantId: string, q: AuditLogQueryParams = {}) => c.get<AuditLogList>(`/platform/tenants/${enc(tenantId)}/audit-logs`, { query: { ...q } }),
    },
    notifications: {
      list: (q: NotificationsQuery = {}) => c.get<NotificationList>("/platform/notifications", { query: q }),
      resend: (id: string) => c.post<{ id: string }>(`/platform/notifications/${enc(id)}/resend`),
    },

    payments: {
      list: (q: { tenantId?: string; method?: string; from?: string; to?: string; page?: number; pageSize?: number } = {}) =>
        c.get<PaymentList>("/platform/payments", { query: q }),
      get: (id: string) => c.get<Receipt>(`/platform/payments/${enc(id)}`),
      receiptPdf: (id: string) => c.download(`/platform/payments/${enc(id)}/receipt.pdf`),
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
    auditLogs: (q: AuditLogQueryParams = {}) => c.get<AuditLogList>("/tenant/audit-logs", { query: { ...q } }),
    notifications: {
      list: (q: NotificationsQuery = {}) => c.get<NotificationList>("/tenant/notifications", { query: q }),
      resend: (id: string) => c.post<{ id: string }>(`/tenant/notifications/${enc(id)}/resend`),
    },
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

    // ── Phase 1 ──
    staff: {
      list: () => c.get<StaffMember[]>("/tenant/staff"),
      create: (body: CreateStaffInput) => c.post<StaffMember & { temporaryPassword: string }>("/tenant/staff", body),
      update: (id: string, body: { firstName?: string; lastName?: string; phone?: string; role?: StaffRole }) =>
        c.patch<StaffMember>(`/tenant/staff/${enc(id)}`, body),
    },
    tables: {
      list: (q: { all?: boolean } = {}) => c.get<DiningTable[]>("/tenant/tables", { query: { all: q.all ? "true" : undefined } }),
      create: (body: TableInput & Partial<Omit<TableLayoutEntry, "id">> & { floorPlanId?: string }) => c.post<DiningTable>("/tenant/tables", body),
      merge: (tableIds: string[]) => c.post<DiningTable>("/tenant/tables/merge", { tableIds }),
      split: (id: string) => c.post<DiningTable>(`/tenant/tables/${enc(id)}/split`),
      update: (id: string, body: Partial<TableInput>) => c.patch<DiningTable>(`/tenant/tables/${enc(id)}`, body),
      setStatus: (id: string, status: TableStatus) => c.patch<DiningTable>(`/tenant/tables/${enc(id)}/status`, { status }),
      remove: (id: string) => c.delete<{ archived?: true; deleted?: true }>(`/tenant/tables/${enc(id)}`),
    },
    menu: {
      get: () => c.get<MenuCategory[]>("/tenant/menu"),
      allergens: () => c.get<Allergen[]>("/tenant/menu/allergens"),
      createCategory: (body: Partial<CategoryInput> & { name: string }) => c.post<Omit<MenuCategory, "items">>("/tenant/menu/categories", body),
      updateCategory: (id: string, body: Partial<CategoryInput>) => c.patch<Omit<MenuCategory, "items">>(`/tenant/menu/categories/${enc(id)}`, body),
      deleteCategory: (id: string) => c.delete<{ archived?: true; deleted?: true }>(`/tenant/menu/categories/${enc(id)}`),
      reorderCategories: (ids: string[]) => c.post<{ ok: true }>("/tenant/menu/categories/reorder", { ids }),
      reorderItems: (ids: string[]) => c.post<{ ok: true }>("/tenant/menu/items/reorder", { ids }),
      createItem: (body: MenuItemInput) => c.post<MenuItem>("/tenant/menu/items", body),
      updateItem: (id: string, body: Partial<MenuItemInput>) => c.patch<MenuItem>(`/tenant/menu/items/${enc(id)}`, body),
      setAvailability: (id: string, isAvailable: boolean) => c.patch<MenuItem>(`/tenant/menu/items/${enc(id)}/availability`, { isAvailable }),
      deleteItem: (id: string) => c.delete<{ archived?: true; deleted?: true }>(`/tenant/menu/items/${enc(id)}`),
      uploadImage: (id: string, file: Blob) => c.upload<{ imageUrl: string }>(`/tenant/menu/items/${enc(id)}/image`, file),
      removeImage: (id: string) => c.delete<void>(`/tenant/menu/items/${enc(id)}/image`),
      formulas: () => c.get<Formula[]>("/tenant/menu/formulas"),
      createFormula: (body: FormulaInput) => c.post<Formula>("/tenant/menu/formulas", body),
      updateFormula: (id: string, body: FormulaUpdateInput) => c.patch<Formula>(`/tenant/menu/formulas/${enc(id)}`, body),
      deleteFormula: (id: string) => c.delete<{ archived?: true; deleted?: true }>(`/tenant/menu/formulas/${enc(id)}`),
      promotions: () => c.get<Promotion[]>("/tenant/menu/promotions"),
      createPromotion: (body: PromotionInput) => c.post<Promotion>("/tenant/menu/promotions", body),
      updatePromotion: (id: string, body: PromotionInput) => c.put<Promotion>(`/tenant/menu/promotions/${enc(id)}`, body),
      setPromotionActive: (id: string, isActive: boolean) => c.patch<Promotion>(`/tenant/menu/promotions/${enc(id)}`, { isActive }),
      deletePromotion: (id: string) => c.delete<{ deleted: true }>(`/tenant/menu/promotions/${enc(id)}`),
    },
    floorPlans: {
      list: () => c.get<FloorPlan[]>("/tenant/floor-plans"),
      create: (body: { name: string; width?: number; height?: number }) => c.post<FloorPlan>("/tenant/floor-plans", body),
      update: (id: string, body: { name?: string; width?: number; height?: number }) => c.patch<FloorPlan>(`/tenant/floor-plans/${enc(id)}`, body),
      remove: (id: string) => c.delete<{ deleted: true }>(`/tenant/floor-plans/${enc(id)}`),
      saveLayout: (id: string, tables: TableLayoutEntry[]) => c.put<DiningTable[]>(`/tenant/floor-plans/${enc(id)}/layout`, { tables }),
    },
    orders: {
      move: (id: string, tableId: string) => c.post<Order>(`/tenant/orders/${enc(id)}/move`, { tableId }),
      list: (q: OrdersQuery = {}) => c.get<Paginated<Order>>("/tenant/orders", { query: { ...q } }),
      get: (id: string) => c.get<Order>(`/tenant/orders/${enc(id)}`),
      receipt: (id: string) => c.get<OrderReceipt>(`/tenant/orders/${enc(id)}/receipt`),
      create: (body: CreateOrderInput) => c.post<Order>("/tenant/orders", body),
      addItems: (id: string, items: OrderItemInput[]) => c.post<Order>(`/tenant/orders/${enc(id)}/items`, { items }),
      updateItem: (id: string, itemId: string, body: { quantity?: number; instructions?: string }) =>
        c.patch<Order>(`/tenant/orders/${enc(id)}/items/${enc(itemId)}`, body),
      setItemStatus: (id: string, itemId: string, status: Exclude<OrderItemStatus, "CANCELLED">) =>
        c.post<Order>(`/tenant/orders/${enc(id)}/items/${enc(itemId)}/status`, { status }),
      advance: (id: string, status: "IN_PROGRESS" | "READY" | "SERVED") => c.post<Order>(`/tenant/orders/${enc(id)}/advance`, { status }),
      cancelItem: (id: string, itemId: string, reason: string) => c.post<Order>(`/tenant/orders/${enc(id)}/items/${enc(itemId)}/cancel`, { reason }),
      cancel: (id: string, reason: string) => c.post<Order>(`/tenant/orders/${enc(id)}/cancel`, { reason }),
      pay: (id: string, body: OrderPaymentInput) => c.post<OrderPaymentResult>(`/tenant/orders/${enc(id)}/payments`, body),
      refund: (id: string, paymentId: string, reason: string) => c.post<Order>(`/tenant/orders/${enc(id)}/payments/${enc(paymentId)}/refund`, { reason }),
      /** P2C : lien de suivi à imprimer sur le ticket (stable). */
      trackingLink: (id: string) => c.get<{ token: string; url: string }>(`/tenant/orders/${enc(id)}/tracking-link`),
    },
    /** X2 : livraison (plan avec `delivery`). Zones (lecture salle, écriture responsables), dispatch, rapprochement ; `mine*` : livreur (rôle DRIVER). */
    delivery: {
      zones: () => c.get<DeliveryZone[]>("/tenant/delivery/zones"),
      createZone: (body: DeliveryZoneInput) => c.post<DeliveryZone>("/tenant/delivery/zones", body),
      updateZone: (id: string, body: DeliveryZoneUpdate) => c.patch<DeliveryZone>(`/tenant/delivery/zones/${enc(id)}`, body),
      deleteZone: (id: string) => c.delete<{ id: string; deleted: true }>(`/tenant/delivery/zones/${enc(id)}`),
      drivers: () => c.get<DeliveryDriver[]>("/tenant/delivery/drivers"),
      board: (date?: string) => c.get<DeliveryBoard>("/tenant/delivery", { query: date ? { date } : {} }),
      get: (id: string) => c.get<Delivery>(`/tenant/delivery/${enc(id)}`),
      assign: (id: string, driverId: string) => c.post<Delivery>(`/tenant/delivery/${enc(id)}/assign`, { driverId }),
      settlements: () => c.get<DeliverySettlements>("/tenant/delivery/settlements"),
      settle: (driverId: string) => c.post<DeliverySettleResult>("/tenant/delivery/settlements", { driverId }),
      mine: () => c.get<DeliveryBoard>("/tenant/delivery/mine"),
      mineGet: (id: string) => c.get<Delivery>(`/tenant/delivery/mine/${enc(id)}`),
      pickup: (id: string) => c.post<Delivery>(`/tenant/delivery/mine/${enc(id)}/pickup`),
      deliver: (id: string, body: CompleteDeliveryInput) => c.post<Delivery>(`/tenant/delivery/mine/${enc(id)}/deliver`, body),
      fail: (id: string, reason: string) => c.post<Delivery>(`/tenant/delivery/mine/${enc(id)}/fail`, { reason }),
    },
    /** P2C : avis des clients (responsables). */
    reviews: {
      list: (q: Partial<ListReviewsQuery> = {}) => c.get<Paginated<Review>>("/tenant/reviews", { query: Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== "all" && v !== false).map(([k, v]) => [k, String(v)])) }),
      stats: () => c.get<ReviewStats>("/tenant/reviews/stats"),
      hide: (id: string) => c.post<Review>(`/tenant/reviews/${enc(id)}/hide`),
      unhide: (id: string) => c.post<Review>(`/tenant/reviews/${enc(id)}/unhide`),
      reply: (id: string, text: string) => c.put<Review>(`/tenant/reviews/${enc(id)}/reply`, { text }),
      deleteReply: (id: string) => c.delete<Review>(`/tenant/reviews/${enc(id)}/reply`),
    },
    /** Écran cuisine : commandes ouvertes avec des articles à préparer ou prêts (les plus anciennes d'abord). */
    kitchen: () => c.get<Order[]>("/tenant/kitchen"),
    register: {
      current: () => c.get<RegisterCurrent>("/tenant/register/current"),
      sessions: () => c.get<RegisterSession[]>("/tenant/register/sessions"),
      open: (opening: number) => c.post<RegisterCurrent>("/tenant/register/open", { opening }),
      close: (body: { counted: number; notes?: string }) => c.post<RegisterCloseResult>("/tenant/register/close", body),
    },
    dashboard: (date?: string) => c.get<TenantDashboard>("/tenant/dashboard", { query: { date } }),

    // ── P5 : rapports (module `reports` du plan, sinon 403 PLAN_FEATURE) ──
    reports: {
      sales: (q: { from: string; to: string }) => c.get<SalesReport>("/tenant/reports/sales", { query: q }),
      vat: (q: { from: string; to: string }) => c.get<VatReport>("/tenant/reports/vat", { query: q }),
      register: (q: { from: string; to: string }) => c.get<RegisterReport>("/tenant/reports/register", { query: q }),
      margins: (q: { from: string; to: string }) => c.get<MarginsReport>("/tenant/reports/margins", { query: q }),
      waste: (q: { from: string; to: string }) => c.get<WasteReport>("/tenant/reports/waste", { query: q }),
      staff: (q: { from: string; to: string }) => c.get<Performance>("/tenant/reports/staff", { query: q }),
      reviews: (q: { from: string; to: string }) => c.get<ReviewsReport>("/tenant/reports/reviews", { query: q }),
      peakHours: (q: { from: string; to: string }) => c.get<PeakHoursReport>("/tenant/reports/peak-hours", { query: q }),
      download: (kind: ReportKind, q: { from: string; to: string }, format: "csv" | "pdf") => c.download(`/tenant/reports/export/${kind}`, { ...q, format }),
    },
    /** Facture PDF d'une commande (tous plans). */
    invoice: (orderId: string) => c.download(`/tenant/orders/${enc(orderId)}/invoice.pdf`),
    licenseReceipt: (paymentId: string) => c.download(`/tenant/license/payments/${enc(paymentId)}/receipt.pdf`),

    // ── P3 : stock (module `inventory` du plan, sinon 403 PLAN_FEATURE) ──
    inventory: {
      ingredients: (q: IngredientsQuery = {}) =>
        c.get<Ingredient[]>("/tenant/inventory/ingredients", { query: { ...q, archived: q.archived === undefined ? undefined : String(q.archived) } }),
      categories: () => c.get<string[]>("/tenant/inventory/ingredients/categories"),
      ingredient: (id: string) => c.get<Ingredient>(`/tenant/inventory/ingredients/${enc(id)}`),
      createIngredient: (body: IngredientInput) => c.post<Ingredient>("/tenant/inventory/ingredients", body),
      updateIngredient: (id: string, body: IngredientUpdate) => c.patch<Ingredient>(`/tenant/inventory/ingredients/${enc(id)}`, body),
      removeIngredient: (id: string) => c.delete<{ archived?: true; deleted?: true }>(`/tenant/inventory/ingredients/${enc(id)}`),
      adjust: (id: string, body: StockAdjustInput) => c.post<Ingredient>(`/tenant/inventory/ingredients/${enc(id)}/adjust`, body),
      movements: (q: MovementsQuery = {}) => c.get<Paginated<StockMovement>>("/tenant/inventory/movements", { query: { ...q } }),
      waste: (q: { from?: string; to?: string; page?: number; pageSize?: number } = {}) => c.get<WasteList>("/tenant/inventory/waste", { query: { ...q } }),
      declareWaste: (body: WasteInput) => c.post<WasteRecord>("/tenant/inventory/waste", body),
      alerts: () => c.get<StockAlert[]>("/tenant/inventory/alerts"),
      dishCosts: () => c.get<DishCost[]>("/tenant/inventory/dish-costs"),
      counts: () => c.get<StockCountSummary[]>("/tenant/inventory/counts"),
      count: (id: string) => c.get<StockCount>(`/tenant/inventory/counts/${enc(id)}`),
      createCount: (body: CreateStockCountInput) => c.post<StockCount>("/tenant/inventory/counts", body),
      saveCount: (id: string, lines: StockCountLinesInput["lines"]) => c.patch<StockCount>(`/tenant/inventory/counts/${enc(id)}/lines`, { lines }),
      validateCount: (id: string) => c.post<StockCount>(`/tenant/inventory/counts/${enc(id)}/validate`),
      cancelCount: (id: string) => c.post<StockCount>(`/tenant/inventory/counts/${enc(id)}/cancel`),
    },
    recipes: {
      dish: (menuItemId: string) => c.get<DishRecipe>(`/tenant/menu/items/${enc(menuItemId)}/recipe`),
      setDish: (menuItemId: string, body: RecipeInput) => c.put<DishRecipe>(`/tenant/menu/items/${enc(menuItemId)}/recipe`, body),
      option: (optionId: string) => c.get<OptionRecipe>(`/tenant/menu/options/${enc(optionId)}/recipe`),
      setOption: (optionId: string, body: RecipeInput) => c.put<OptionRecipe>(`/tenant/menu/options/${enc(optionId)}/recipe`, body),
    },
    suppliers: {
      list: (q: { all?: boolean } = {}) => c.get<Supplier[]>("/tenant/suppliers", { query: { all: q.all ? "true" : undefined } }),
      create: (body: SupplierInput) => c.post<Supplier>("/tenant/suppliers", body),
      update: (id: string, body: SupplierUpdate) => c.patch<Supplier>(`/tenant/suppliers/${enc(id)}`, body),
      remove: (id: string) => c.delete<{ archived?: true; deleted?: true }>(`/tenant/suppliers/${enc(id)}`),
    },
    purchaseOrders: {
      list: (q: { status?: PurchaseStatus; supplierId?: string } = {}) => c.get<PurchaseOrder[]>("/tenant/purchase-orders", { query: { ...q } }),
      get: (id: string) => c.get<PurchaseOrder>(`/tenant/purchase-orders/${enc(id)}`),
      create: (body: PurchaseOrderInput) => c.post<PurchaseOrder>("/tenant/purchase-orders", body),
      update: (id: string, body: PurchaseOrderUpdate) => c.patch<PurchaseOrder>(`/tenant/purchase-orders/${enc(id)}`, body),
      send: (id: string) => c.post<PurchaseOrder>(`/tenant/purchase-orders/${enc(id)}/send`),
      receive: (id: string, body: ReceivePurchaseInput) => c.post<PurchaseOrder>(`/tenant/purchase-orders/${enc(id)}/receive`, body),
      cancel: (id: string) => c.post<PurchaseOrder>(`/tenant/purchase-orders/${enc(id)}/cancel`),
    },
    // ── P2A : réservations, horaires, fermetures, liste d'attente ──
    reservations: {
      list: (q: ReservationsQuery = {}) =>
        c.get<Reservation[]>("/tenant/reservations", { query: { ...q, status: Array.isArray(q.status) ? q.status.join(",") : q.status } }),
      get: (id: string) => c.get<Reservation>(`/tenant/reservations/${enc(id)}`),
      availability: (q: { date: string; partySize: number; durationMinutes?: number; excludeReservationId?: string }) =>
        c.get<Availability>("/tenant/reservations/availability", {
          query: { ...q, partySize: String(q.partySize), durationMinutes: q.durationMinutes === undefined ? undefined : String(q.durationMinutes) },
        }),
      create: (body: CreateReservationInput) => c.post<Reservation>("/tenant/reservations", body),
      update: (id: string, body: UpdateReservationInput) => c.patch<Reservation>(`/tenant/reservations/${enc(id)}`, body),
      confirm: (id: string) => c.post<Reservation>(`/tenant/reservations/${enc(id)}/confirm`),
      seat: (id: string) => c.post<Reservation>(`/tenant/reservations/${enc(id)}/seat`),
      complete: (id: string) => c.post<Reservation>(`/tenant/reservations/${enc(id)}/complete`),
      cancel: (id: string, body: Partial<CancelReservationInput> = {}) => c.post<CancelledReservation>(`/tenant/reservations/${enc(id)}/cancel`, body),
      noShow: (id: string) => c.post<Reservation>(`/tenant/reservations/${enc(id)}/no-show`),
      waitlistMatches: (id: string) => c.get<WaitlistEntry[]>(`/tenant/reservations/${enc(id)}/waitlist-matches`),
    },
    openingHours: {
      get: () => c.get<{ ranges: OpeningRange[] }>("/tenant/opening-hours"),
      set: (body: OpeningHoursInput) => c.put<{ ranges: OpeningRange[] }>("/tenant/opening-hours", body),
    },
    closures: {
      list: (q: { from?: string; to?: string } = {}) => c.get<ClosureDay[]>("/tenant/closures", { query: { ...q } }),
      create: (body: ClosureInput) => c.post<ClosureCreated>("/tenant/closures", body),
      remove: (id: string) => c.delete<void>(`/tenant/closures/${enc(id)}`),
    },
    // ── P4 : personnel (module `staff` du plan, sauf la messagerie) ──
    staffHr: {
      profiles: () => c.get<StaffFile[]>("/tenant/staff/profiles"),
      saveProfile: (userId: string, body: StaffProfileInput) => c.put<StaffFile>(`/tenant/staff/profiles/${enc(userId)}`, body),
      setKioskCode: (userId: string, body: KioskCodeInput) => c.put<{ ok: true }>(`/tenant/staff/profiles/${enc(userId)}/kiosk-code`, body),
      removeKioskCode: (userId: string) => c.delete<{ ok: true }>(`/tenant/staff/profiles/${enc(userId)}/kiosk-code`),
      unlockKiosk: (userId: string) => c.post<{ ok: true }>(`/tenant/staff/profiles/${enc(userId)}/kiosk-unlock`),
      me: () => c.get<StaffFile>("/tenant/staff/me"),
      planning: (week?: string) => c.get<Planning>("/tenant/staff/planning", { query: { week } }),
      myPlanning: (week?: string) => c.get<Planning>("/tenant/staff/planning/mine", { query: { week } }),
      createShift: (body: ShiftInput) => c.post<Shift>("/tenant/staff/shifts", body),
      updateShift: (id: string, body: ShiftUpdate) => c.patch<Shift>(`/tenant/staff/shifts/${enc(id)}`, body),
      removeShift: (id: string) => c.delete<{ ok: true }>(`/tenant/staff/shifts/${enc(id)}`),
      copyWeek: (body: CopyWeekInput) => c.post<{ copied: number; skipped: number; week: string }>("/tenant/staff/planning/copy", body),
      publish: (body: PublishWeekInput) => c.post<{ published: number; people: number; notified: number; week: string }>("/tenant/staff/planning/publish", body),
      myAttendance: () => c.get<MyAttendance>("/tenant/staff/me/attendance"),
      punch: (action: PunchAction) => c.post<Attendance>("/tenant/staff/me/punch", { action }),
      kiosk: () => c.get<KioskPerson[]>("/tenant/staff/kiosk"),
      kioskPunch: (body: KioskPunchInput) => c.post<Attendance & { name: string }>("/tenant/staff/kiosk/punch", body),
      attendance: (q: { from: string; to: string; staffId?: string }) => c.get<Attendance[]>("/tenant/staff/attendance", { query: { ...q } }),
      present: () => c.get<Attendance[]>("/tenant/staff/attendance/present"),
      createAttendance: (body: AttendanceCreateInput) => c.post<Attendance>("/tenant/staff/attendance", body),
      correctAttendance: (id: string, body: AttendanceCorrectionInput) => c.patch<Attendance>(`/tenant/staff/attendance/${enc(id)}`, body),
      absences: (q: { status?: AbsenceStatus; mine?: boolean } = {}) => c.get<PlanningAbsence[]>("/tenant/staff/absences", { query: { status: q.status, mine: q.mine === undefined ? undefined : String(q.mine) } }),
      balance: (q: { userId?: string; year?: number } = {}) => c.get<LeaveBalance>("/tenant/staff/absences/balance", { query: { ...q } }),
      requestAbsence: (body: AbsenceInput) => c.post<PlanningAbsence>("/tenant/staff/absences", body),
      decideAbsence: (id: string, body: AbsenceDecisionInput) => c.post<PlanningAbsence>(`/tenant/staff/absences/${enc(id)}/decision`, body),
      cancelAbsence: (id: string) => c.delete<{ ok: true }>(`/tenant/staff/absences/${enc(id)}`),
      performance: (q: { from: string; to: string }) => c.get<Performance>("/tenant/staff/performance", { query: { ...q } }),
      payroll: (q: { from: string; to: string }) => c.get<Payroll>("/tenant/staff/payroll", { query: { ...q } }),
      /** Contenu du CSV (texte) : à enregistrer côté navigateur. */
      payrollCsv: (q: { from: string; to: string }) => c.get<string>("/tenant/staff/payroll/export", { query: { ...q } }),
    },
    // ── P4 : messagerie interne (ouverte à tous les plans) ──
    messaging: {
      channels: () => c.get<ChatChannel[]>("/tenant/messaging/channels"),
      unread: () => c.get<{ unread: number; mentions: number }>("/tenant/messaging/unread"),
      people: () => c.get<{ id: string; name: string; role: StaffRole }[]>("/tenant/messaging/people"),
      direct: (userId: string) => c.post<ChatChannel>("/tenant/messaging/direct", { userId }),
      messages: (channelId: string, q: { before?: string; limit?: number } = {}) =>
        c.get<{ messages: ChatMessage[]; hasMore: boolean }>(`/tenant/messaging/channels/${enc(channelId)}/messages`, { query: { ...q } }),
      send: (channelId: string, body: { body: string; mentions?: string[] }) => c.post<ChatMessage>(`/tenant/messaging/channels/${enc(channelId)}/messages`, body),
      read: (channelId: string) => c.post<{ ok: true }>(`/tenant/messaging/channels/${enc(channelId)}/read`),
    },
    waitlist: {
      list: (q: { date?: string; status?: WaitlistStatus } = {}) => c.get<WaitlistEntry[]>("/tenant/waitlist", { query: { ...q } }),
      create: (body: WaitlistInput) => c.post<WaitlistEntry>("/tenant/waitlist", body),
      notify: (id: string) => c.post<WaitlistEntry & { notifications: ("queued" | "skipped")[] }>(`/tenant/waitlist/${enc(id)}/notify`),
      convert: (id: string, body: ConvertWaitlistInput = {}) => c.post<{ entry: WaitlistEntry; reservation: Reservation }>(`/tenant/waitlist/${enc(id)}/convert`, body),
      remove: (id: string) => c.post<WaitlistEntry>(`/tenant/waitlist/${enc(id)}/remove`),
    },
  };
}

export type AuthApi = ReturnType<typeof authApi>;
export type AccountApi = ReturnType<typeof accountApi>;
export type PublicApi = ReturnType<typeof publicApi>;
export type CustomerApi = ReturnType<typeof customerApi>;
export type PlatformApi = ReturnType<typeof platformApi>;
export type TenantApi = ReturnType<typeof tenantApi>;
export type { AccountSummary };
