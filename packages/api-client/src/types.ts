import type {
  BillingCycle, PlatformPaymentMethod, PlatformRole, Role, SubscriptionStatus, TenantStatus,
} from "@restaurant/shared-types";
import type { PasswordPolicy, Theme } from "@restaurant/utils";
import type {
  BusinessInput, CompanyInput, LicensingSettings, LocalizationInput, NotificationsSettingsInput, OperationsInput, PaymentInstructionsInput,
  PlatformSecurityInput, ReservationsSettingsInput, TenantSecurityInput,
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

/** Une ligne du journal des notifications (destinataire masqué par l'API). */
export interface NotificationLogItem {
  id: string;
  tenantId: string | null;
  /** Présent dans la vue plateforme uniquement. */
  tenant?: { id: string; name: string; slug: string } | null;
  channel: "EMAIL" | "SMS";
  to: string;
  template: string;
  category: "transactional" | "reminder";
  subject: string | null;
  status: "QUEUED" | "SENT" | "FAILED";
  error: string | null;
  attempts: number;
  createdAt: ISODate;
  sentAt: ISODate | null;
  resendOfId: string | null;
  canResend: boolean;
}
export type NotificationList = Paginated<NotificationLogItem>;
export type NotificationsQuery = {
  channel?: "EMAIL" | "SMS";
  status?: "QUEUED" | "SENT" | "FAILED";
  template?: string;
  /** Plateforme : `none` = messages de la plateforme, sinon identifiant d'un restaurant. */
  tenantId?: string;
  page?: number;
  pageSize?: number;
};

export interface TenantSettingsAll {
  notifications?: NotificationsSettingsInput;
  reservations?: ReservationsSettingsInput;
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
  /** Plage horaire de service « HH:MM » (fuseau du restaurant) ; null = toute la journée. */
  availableFrom: string | null;
  availableTo: string | null;
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

export type PublicMenuItem = Omit<MenuItem, "sortOrder" | "archived" | "isAvailable" | "vatRate" | "prepMinutes"> & {
  /** Faux hors de la plage horaire : plat grisé. */
  availableNow: boolean;
  /** Promotion en cours (prix remisé). */
  promotion: { name: string; unitPrice: number } | null;
};

export interface FormulaStep {
  id: string;
  name: string;
  minChoices: number;
  maxChoices: number;
  items: { menuItemId: string; name: string; price: number; isAvailable: boolean }[];
}
/** Menu à prix fixe : étapes avec choix parmi des plats. */
export interface Formula {
  id: string;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
  availableFrom: string | null;
  availableTo: string | null;
  sortOrder: number;
  steps: FormulaStep[];
}
export type PromotionKind = "PERCENT" | "AMOUNT";
export interface Promotion {
  id: string;
  name: string;
  kind: PromotionKind;
  value: number;
  menuItemId: string | null;
  categoryId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  days: number[];
  fromTime: string | null;
  toTime: string | null;
  isActive: boolean;
}
export interface PublicFormula {
  id: string;
  name: string;
  description: string | null;
  price: number;
  availableFrom: string | null;
  availableTo: string | null;
  availableNow: boolean;
  steps: { id: string; name: string; minChoices: number; maxChoices: number; items: { menuItemId: string; name: string }[] }[];
}
export interface PublicMenu {
  restaurant: { name: string; slug: string; currency: string };
  categories: { id: string; name: string; description: string | null; items: PublicMenuItem[] }[];
  formulas: PublicFormula[];
}

export type OrderStatus = "PENDING" | "IN_PROGRESS" | "READY" | "DELIVERED" | "CANCELLED";
export type OrderItemStatus = "PENDING" | "IN_PROGRESS" | "READY" | "SERVED" | "CANCELLED";
export type OrderPaymentStatus = "UNPAID" | "PARTIAL" | "PAID";
export type OrderType = "DINE_IN" | "TAKEAWAY";
export type OrderPaymentMethod = "CASH" | "CARD" | "FLOOZ" | "TMONEY" | "OTHER";

export interface OrderItem {
  id: string;
  /** Null pour une ligne « formule » (ses plats sont des lignes enfants à 0 FCFA). */
  menuItemId: string | null;
  formulaId: string | null;
  parentItemId: string | null;
  /** Ligne enfant : étape de la formule (« Entrée »). */
  stepName: string | null;
  /** Remise promotionnelle de la ligne (déjà déduite de unitPrice). */
  discount: number;
  promotionName: string | null;
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
  /** P2A : réservation dont la commande a été ouverte. */
  reservationId?: string | null;
  customerName: string | null;
  notes: string | null;
  waiter: { id: string; firstName: string; lastName: string } | null;
  /** Total des remises promotionnelles (« dont remise »). */
  discountTotal: number;
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
  topItems: { menuItemId: string | null; name: string; quantity: number; revenue: number }[];
}

// ── P3 : stock ──

export type StockUnit = "g" | "kg" | "ml" | "cl" | "l" | "piece";
export type StockState = "NEGATIVE" | "OUT" | "LOW" | "OK";
export type MovementType = "PURCHASE" | "ORDER_DEDUCTION" | "WASTE" | "ADJUSTMENT" | "RETURN";
export type PurchaseStatus = "DRAFT" | "SENT" | "PARTIAL" | "RECEIVED" | "CANCELLED";
export type StockCountStatus = "OPEN" | "VALIDATED" | "CANCELLED";
export type UserRef = { id: string; firstName: string; lastName: string } | null;
export type IngredientRef = { id: string; name: string; unit: StockUnit };

export interface Ingredient {
  id: string;
  name: string;
  unit: StockUnit;
  category: string | null;
  quantity: number;
  lowStockThreshold: number;
  reorderQty: number | null;
  avgCost: number;
  /** Valeur du stock (FCFA), 0 si négatif. */
  value: number;
  state: StockState;
  autoDisable: boolean;
  isActive: boolean;
  supplier: { id: string; name: string } | null;
  lowAlertedAt: ISODate | null;
  updatedAt: ISODate;
}
export interface StockAlert extends Ingredient { suggestedQty: number | null }
/** Charge utile de `stock.updated` (`{ ingredients }`) et de `stock.low` (un élément) : sans coûts. */
export type StockLight = Pick<Ingredient, "id" | "name" | "unit" | "quantity" | "lowStockThreshold" | "state">;
export interface IngredientsQuery { search?: string; category?: string; state?: StockState | "ALERT"; archived?: boolean }

export interface StockMovement {
  id: string;
  type: MovementType;
  ingredient: IngredientRef;
  quantity: number;
  balanceAfter: number;
  unitCost: number | null;
  value: number | null;
  reason: string | null;
  orderItemId: string | null;
  purchaseOrderId: string | null;
  stockCountId: string | null;
  user: UserRef;
  createdAt: ISODate;
}
export interface MovementsQuery { ingredientId?: string; type?: MovementType; from?: string; to?: string; page?: number; pageSize?: number }

export interface WasteRecord {
  id: string;
  ingredient: IngredientRef;
  quantity: number;
  reason: string;
  cost: number;
  /** Perte automatique (article annulé après lancement). */
  automatic: boolean;
  recordedBy?: UserRef;
  createdAt: ISODate;
}
export interface WasteList extends Paginated<WasteRecord> { totalCost: number }

export interface RecipeLineView {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: StockUnit;
  ingredientUnit: StockUnit;
  avgCost: number;
  cost: number;
  archived: boolean;
}
export interface OptionRecipe { optionId: string; name: string; group: string; extra: number; lines: RecipeLineView[]; cost: number }
export interface DishRecipe {
  menuItemId: string;
  name: string;
  price: number;
  vatRate: number;
  lines: RecipeLineView[];
  /** Prix hors TVA, coût matière, marge (FCFA) et taux de marge (% du prix HT). */
  net: number;
  cost: number;
  margin: number;
  marginRate: number | null;
  options: OptionRecipe[];
}
export interface DishCost {
  menuItemId: string; name: string; category: string; price: number; isAvailable: boolean; hasRecipe: boolean;
  net: number; cost: number; margin: number; marginRate: number | null;
}

export interface StockCountSummary {
  id: string; status: StockCountStatus; category: string | null; notes: string | null; varianceCost: number;
  createdAt: ISODate; validatedAt: ISODate | null; lineCount: number; countedCount: number;
}
export interface StockCountLine {
  ingredient: { id: string; name: string; unit: StockUnit; category: string | null };
  expectedQty: number;
  countedQty: number | null;
  variance: number | null;
  varianceCost: number | null;
  /** Coût moyen actuel (FCFA par unité) : estimation de l'écart pendant la saisie. */
  unitCost: number;
}
export interface StockCount {
  id: string; status: StockCountStatus; category: string | null; notes: string | null; createdAt: ISODate; validatedAt: ISODate | null;
  varianceCost: number; lines: StockCountLine[];
}

export interface Supplier {
  id: string; name: string; contact: string | null; email: string | null; phone: string | null; address: string | null;
  notes: string | null; isActive: boolean; ingredientCount: number; createdAt: ISODate;
}
export interface PurchaseOrderLine { id: string; ingredient: IngredientRef; quantity: number; receivedQty: number; unitCost: number; total: number }
export interface PurchaseOrder {
  id: string;
  status: PurchaseStatus;
  supplier: { id: string; name: string; phone: string | null; email: string | null };
  expectedAt: ISODate | null;
  sentAt: ISODate | null;
  receivedAt: ISODate | null;
  cancelledAt: ISODate | null;
  notes: string | null;
  total: number;
  receivedValue: number;
  createdAt: ISODate;
  updatedAt: ISODate;
  lines: PurchaseOrderLine[];
}

// ── P2A : réservations ──

export type ReservationStatus = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type ReservationSource = "PHONE" | "WALK_IN" | "ONLINE";
export type WaitlistStatus = "WAITING" | "NOTIFIED" | "CONVERTED" | "EXPIRED" | "REMOVED";

/** Plage d'ouverture (heure locale) ; `weekday` 0 = dimanche … 6 = samedi ; `closesAt` ≤ `opensAt` = après minuit. */
export interface OpeningRange { weekday: number; opensAt: string; closesAt: string; slotMinutes: number }
export interface ClosureDay { id: string; date: string; reason: string | null; createdAt: ISODate }

export interface ReservationTableRef { id: string; label: string; capacity: number }

/** Réservation côté salle (même forme dans l'API et les événements `reservation.created|updated`). */
export interface Reservation {
  id: string;
  code: string;
  status: ReservationStatus;
  source: ReservationSource;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  partySize: number;
  startsAt: ISODate;
  endsAt: ISODate;
  durationMinutes: number;
  tables: ReservationTableRef[];
  specialRequests: string | null;
  notes: string | null;
  overrideReason: string | null;
  /** Commande ouverte depuis la réservation (sinon la plus récente). */
  orderId: string | null;
  /** Retard au-delà du délai de grâce : proposer « absent ». */
  noShowSuggested: boolean;
  confirmedAt: ISODate | null;
  seatedAt: ISODate | null;
  completedAt: ISODate | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  noShowAt: ISODate | null;
  reminderSentAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface WaitlistEntry {
  id: string;
  status: WaitlistStatus;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  partySize: number;
  desiredAt: ISODate;
  notes: string | null;
  notifiedAt: ISODate | null;
  reservationId: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CancelledReservation extends Reservation { waitlistMatches: WaitlistEntry[] }
export interface ClosureCreated extends ClosureDay { affectedReservations: Reservation[] }

export interface AvailabilitySlot {
  startsAt: ISODate;
  endsAt: ISODate;
  available: boolean;
  /** `past` : créneau passé ; `full` : aucune table. */
  reason?: "past" | "full";
  /** Tables proposées (une, ou deux combinées). */
  tables: ReservationTableRef[];
}
export interface Availability {
  date: string;
  timezone: string;
  partySize: number;
  durationMinutes: number;
  closed: boolean;
  closureReason: string | null;
  openingWindows: { start: ISODate; end: ISODate }[];
  slots: AvailabilitySlot[];
}
export interface PublicAvailability {
  date: string;
  timezone: string;
  partySize: number;
  durationMinutes: number;
  closed: boolean;
  closureReason: string | null;
  slots: { startsAt: ISODate; endsAt: ISODate }[];
}
export interface ReservationsQuery { date?: string; from?: string; to?: string; status?: ReservationStatus | ReservationStatus[]; search?: string }

/** Réservation vue par le client (lien de gestion). */
export interface PublicReservation {
  code: string;
  status: ReservationStatus;
  guestName: string;
  partySize: number;
  startsAt: ISODate;
  endsAt: ISODate;
  specialRequests: string | null;
  createdAt: ISODate;
  restaurant: { name: string; slug: string; phone: string | null; timezone: string };
  canModify: boolean;
  canCancel: boolean;
}
export interface PublicReservationCreated {
  code: string;
  status: ReservationStatus;
  /** Jeton du lien de gestion : montré une seule fois, jamais conservé en clair. */
  manageToken: string;
  manageUrl: string;
  reservation: PublicReservation;
}
