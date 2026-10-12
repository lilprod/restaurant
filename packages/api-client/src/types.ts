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

// ── Phase 1 : équipe, tables, menu, commandes, cuisine, encaissement, caisse ──

export type StaffRole = "ADMIN" | "MANAGER" | "WAITER" | "KITCHEN";

export interface StaffMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: ISODate | null;
  createdAt: ISODate;
}

export type TableStatus = "FREE" | "RESERVED" | "OCCUPIED" | "CLEANING";

/** Résumé d'une commande ouverte sur une table. */
export interface TableOpenOrder {
  id: string;
  number: number;
  status: OrderStatus;
  total: number;
  paidAmount: number;
  paymentStatus: OrderPaymentStatus;
  createdAt: ISODate;
}

export interface DiningTable {
  id: string;
  tenantId: string;
  label: string;
  capacity: number;
  status: TableStatus;
  isActive: boolean;
  openOrders: TableOpenOrder[];
}

export interface Allergen { code: string; name: string }

export interface MenuOption { id: string; name: string; extra: number }

export interface MenuOptionGroup {
  id: string;
  name: string;
  minChoices: number;
  maxChoices: number;
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  /** Prix TTC en FCFA. */
  price: number;
  vatRate: number;
  imageUrl: string | null;
  prepMinutes: number;
  isAvailable: boolean;
  isDishOfDay: boolean;
  sortOrder: number;
  archived: boolean;
  allergens: Allergen[];
  optionGroups: MenuOptionGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  items: MenuItem[];
}

export type PublicMenuItem = Omit<MenuItem, "sortOrder" | "archived" | "isAvailable" | "vatRate" | "prepMinutes">;
export interface PublicMenu {
  restaurant: { name: string; slug: string; currency: string };
  categories: { id: string; name: string; description: string | null; items: PublicMenuItem[] }[];
}

export type OrderStatus = "PENDING" | "IN_PROGRESS" | "READY" | "DELIVERED" | "CANCELLED";
export type OrderItemStatus = "PENDING" | "IN_PROGRESS" | "READY" | "SERVED" | "CANCELLED";
export type OrderPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type OrderType = "DINE_IN" | "TAKEAWAY";
export type OrderPaymentMethod = "CASH" | "CARD" | "FLOOZ" | "TMONEY" | "OTHER";

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  optionsExtra: number;
  lineTotal: number;
  vatRate: number;
  status: OrderItemStatus;
  instructions: string | null;
  course: number;
  options: { optionId: string; name: string; extra: number }[];
  prepMinutes: number;
  imageUrl: string | null;
  createdAt: ISODate;
  startedAt: ISODate | null;
  readyAt: ISODate | null;
  servedAt: ISODate | null;
  cancelReason: string | null;
  /** Quantité déjà encaissée (partage par article). */
  paidQuantity: number;
}

export interface OrderPayment {
  id: string;
  method: OrderPaymentMethod;
  status: "PAID" | "REFUNDED";
  amount: number;
  tip: number;
  tendered: number | null;
  change: number | null;
  reference: string | null;
  paidAt: ISODate | null;
  refundedAt: ISODate | null;
  refundReason: string | null;
}

/** Commande (même forme dans l'API et les événements temps réel). */
export interface Order {
  id: string;
  number: number;
  type: OrderType | "DELIVERY";
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  table: { id: string; label: string } | null;
  customerName: string | null;
  notes: string | null;
  waiter: { id: string; firstName: string; lastName: string } | null;
  subtotal: number;
  serviceCharge: number;
  vat: number;
  total: number;
  tip: number;
  paidAmount: number;
  remaining: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  closedAt: ISODate | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  items: OrderItem[];
  payments: OrderPayment[];
}

export interface OrdersQuery {
  status?: OrderStatus;
  paymentStatus?: OrderPaymentStatus;
  type?: OrderType;
  tableId?: string;
  open?: boolean;
  /** AAAA-MM-JJ, dans le fuseau du restaurant. */
  date?: string;
  page?: number;
  pageSize?: number;
}

export interface OrderPaymentResult {
  order: Order;
  paymentId: string;
  /** Monnaie rendue (espèces avec somme remise), sinon null. */
  change: number | null;
}

export interface OrderReceipt {
  restaurant: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    taxId: string | null;
    registrationNumber: string | null;
    logoUrl: string | null;
    headerText: string | null;
    footerText: string | null;
  };
  currency: string;
  order: Order;
  vatBreakdown: { rate: number; base: number; vat: number }[];
  printedAt: ISODate;
}

export interface RegisterSession {
  id: string;
  tenantId: string;
  openedById: string;
  openedAt: ISODate;
  closedAt: ISODate | null;
  opening: number;
  closing: number | null;
  expectedCash: number | null;
  difference: number | null;
  closedById: string | null;
  notes: string | null;
}

export interface RegisterSummary {
  byMethod: Partial<Record<OrderPaymentMethod, { amount: number; tips: number; count: number }>>;
  expectedCash: number;
  paymentsCount: number;
  total: number;
}

export type RegisterCurrent = { open: false } | ({ open: true; session: RegisterSession } & RegisterSummary);
export type RegisterCloseResult = { session: RegisterSession } & RegisterSummary;

export interface TenantDashboard {
  date: string;
  revenue: number;
  tips: number;
  ordersCount: number;
  averageTicket: number;
  openOrders: number;
  byType: { DINE_IN: number; TAKEAWAY: number };
  byMethod: { method: OrderPaymentMethod; amount: number }[];
  byHour: { hour: number; orders: number }[];
  topItems: { menuItemId: string; name: string; quantity: number; revenue: number }[];
}
