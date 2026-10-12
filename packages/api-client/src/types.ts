import type {
  BillingCycle, PlatformPaymentMethod, PlatformRole, Role, SubscriptionStatus, TenantStatus,
} from "@restaurant/shared-types";
import type { PasswordPolicy, Theme } from "@restaurant/utils";
import type {
  BusinessInput, CompanyInput, LicensingSettings, LocalizationInput, OperationsInput, PaymentInstructionsInput,
  PlatformSecurityInput, TenantSecurityInput,
} from "@restaurant/validation";
import type { Restriction } from "./errors";

/** Les dates arrivent en JSON : chaînes ISO 8601. */
export type ISODate = string;

export type { BillingCycle, PlatformPaymentMethod, PlatformRole, Role, SubscriptionStatus, TenantStatus, Restriction };
export type RegistrationStatus = "PENDING" | "APPROVED" | "REJECTED";
export type PaymentRecordStatus = "RECORDED" | "VOIDED";
export type LoginResult =
  | "SUCCESS" | "BAD_PASSWORD" | "UNKNOWN_ACCOUNT" | "LOCKED" | "TWO_FACTOR_FAILED" | "TWO_FACTOR_REQUIRED" | "LICENSE_BLOCKED" | "ACCOUNT_DISABLED";

// ── Comptes & authentification ──

export interface AccountSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  locale: string;
  tenantId: string | null;
  twoFactorEnabled: boolean;
  avatarUrl: string | null;
}

export interface Profile extends AccountSummary {
  lastLoginAt: ISODate | null;
  passwordChangedAt: ISODate | null;
  recoveryCodesLeft: number;
  twoFactorRequired: boolean;
  /** Mot de passe temporaire ou expiré à changer. */
  mustChangePassword: boolean;
  /** Restriction en cours de la session (permet de la retrouver après un rechargement). */
  restriction: Restriction | null;
  /** Règles de mot de passe de l'espace (lisibles par tous les rôles). */
  passwordPolicy: PasswordPolicy;
}

export interface LicenseSummary {
  status: SubscriptionStatus | string;
  inGrace: boolean;
  currentPeriodEnd: ISODate;
}

export interface LoginSuccess {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AccountSummary;
  restriction: Restriction | null;
  license?: LicenseSummary;
}

export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

export type LoginResponse = LoginSuccess | TwoFactorChallenge;
export const isTwoFactorChallenge = (r: LoginResponse): r is TwoFactorChallenge => "twoFactorRequired" in r && r.twoFactorRequired === true;

export interface SessionRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: ISODate;
  lastUsedAt: ISODate | null;
  expiresAt: ISODate;
  current: boolean;
}

export interface LoginEvent {
  id: string;
  space: "platform" | "tenant";
  tenantId: string | null;
  userId: string | null;
  platformUserId: string | null;
  email: string;
  result: LoginResult;
  ip: string | null;
  userAgent: string | null;
  createdAt: ISODate;
}

export interface TwoFactorSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

// ── Marque ──

export interface PublicBranding {
  displayName: string;
  tagline: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  theme: Theme;
  cssVars: Record<string, string>;
  warnings: string[];
}

export interface PlatformPublicBranding extends PublicBranding {
  support: { email: string | null; phone: string | null; website: string | null };
}

export interface TenantPublicBranding extends PublicBranding {
  slug: string;
  name: string;
  locale: string;
}

export interface Assets {
  logo?: string | null;
  logoDark?: string | null;
  favicon?: string | null;
}
export type AssetKind = "logo" | "logoDark" | "favicon";

export interface BrandingSettings {
  displayName: string;
  tagline?: string;
  theme: Theme;
  assets: Assets;
  preview: PublicBranding;
}

// ── Plans, restaurants, licences ──

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  maxUsers: number | null;
  maxTables: number | null;
  features: Record<string, boolean>;
  isActive: boolean;
  sortOrder: number;
}
export type PublicPlan = Omit<Plan, "isActive" | "sortOrder">;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  email: string;
  phone: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  locale: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  startsAt: ISODate;
  currentPeriodEnd: ISODate;
  trialEndsAt: ISODate | null;
  graceEndsAt: ISODate | null;
  cancelledAt: ISODate | null;
  createdAt: ISODate;
}

export interface TenantListItem extends Tenant {
  subscription: (Subscription & { plan: { code: string; name: string } }) | null;
}

export interface TenantDetail extends Tenant {
  subscription: (Subscription & { plan: Plan }) | null;
  usersCount: number;
  paymentsCount: number;
}

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface Payment {
  id: string;
  tenantId: string;
  subscriptionId: string;
  method: PlatformPaymentMethod;
  amount: number;
  currency: string;
  billingCycle: BillingCycle;
  periodStart: ISODate;
  periodEnd: ISODate;
  paidAt: ISODate;
  reference: string | null;
  receiptNumber: string;
  notes: string | null;
  status: PaymentRecordStatus;
  recordedById: string;
  voidedAt: ISODate | null;
  voidReason: string | null;
  createdAt: ISODate;
}

export interface SubscriptionWithPayments extends Subscription {
  plan: { code: string; name: string };
  payments: Payment[];
}

export interface PaymentListItem extends Payment {
  tenant: { id: string; name: string; slug: string };
}
export interface PaymentList extends Paginated<PaymentListItem> {
  totalAmount: number;
}

export interface Receipt extends Payment {
  tenant: { name: string; slug: string; email: string };
  subscription: Subscription & { plan: { name: string } };
  recordedBy: { firstName: string; lastName: string };
}

export interface RecordPaymentResult extends Payment {
  subscription: Subscription;
  tenantStatus: TenantStatus;
}

export interface Registration {
  id: string;
  restaurantName: string;
  slug: string;
  ownerFirstName: string;
  ownerLastName: string;
  email: string;
  phone: string | null;
  planId: string | null;
  status: RegistrationStatus;
  rejectionReason: string | null;
  reviewedById: string | null;
  reviewedAt: ISODate | null;
  tenantId: string | null;
  createdAt: ISODate;
}

export interface PlatformDashboard {
  tenants: Partial<Record<TenantStatus, number>>;
  pendingRegistrations: number;
  revenueThisMonth: { total: number; byMethod: { method: PlatformPaymentMethod; amount: number; count: number }[] };
  expiringSoon: {
    tenant: { id: string; name: string; slug: string; email: string; phone: string | null };
    plan: { code: string; name: string };
    status: SubscriptionStatus;
    currentPeriodEnd: ISODate;
  }[];
}

// ── Utilisateurs & sécurité ──

export interface PlatformUserView {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
  isActive: boolean;
  twoFactorEnabled: boolean;
  locked: boolean;
  lastLoginAt: ISODate | null;
}

export interface TenantUserSecurity {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: ISODate | null;
}

// ── Réglages ──

export interface TenantSettingsAll {
  business?: BusinessInput;
  branding?: Omit<BrandingSettings, "preview">;
  operations?: OperationsInput;
  localization?: LocalizationInput;
  security?: TenantSecurityInput;
  assets: Assets;
  currency: string;
}

export interface PlatformSettingsAll {
  branding: Omit<BrandingSettings, "assets" | "preview">;
  company: CompanyInput;
  localization: LocalizationInput;
  security?: PlatformSecurityInput;
  paymentInstructions: PaymentInstructionsInput;
  licensing: LicensingSettings;
  assets: Assets;
}

export interface TenantLicense {
  status: SubscriptionStatus | null;
  plan: Pick<Plan, "code" | "name" | "priceMonthly" | "priceYearly" | "maxUsers" | "maxTables" | "features"> | null;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: ISODate | null;
  graceEndsAt: ISODate | null;
  daysLeft: number | null;
  payments: Pick<Payment, "id" | "receiptNumber" | "amount" | "currency" | "method" | "paidAt" | "periodStart" | "periodEnd">[];
  howToPay: PaymentInstructionsInput;
  support: { email: string | null; phone: string | null; website: string | null };
}
