import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma, type Tenant } from "@prisma/client";
import { normalizePhone } from "@restaurant/utils";
import { DEFAULT_NOTIFICATION_PREFS, type CustomerProfileInput, type CustomerSignupInput, type NotificationPrefs } from "@restaurant/validation";
import * as argon2 from "argon2";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { ReservationsService } from "../reservations/reservations.service";
import type { Account } from "../security/accounts.repo";
import { LicenseGateService } from "../security/license-gate.service";
import { PasswordService } from "../security/password.service";
import { SecurityPolicyService } from "../security/security-policy.service";
import { SessionService } from "../security/session.service";
import { ReviewsService } from "./reviews.service";

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const codeHash = (userId: string, code: string) => createHash("sha256").update(`${userId}:${code}`).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Comptes clients d'un restaurant : inscription, profil, préférences, vérification d'email, export et suppression (RGPD). */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly policies: SecurityPolicyService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationsService,
    private readonly gate: LicenseGateService,
    private readonly reservations: ReservationsService,
    private readonly reviews: ReviewsService,
  ) {}

  private async publicTenant(slug: string): Promise<Tenant> {
    const t = await this.prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!t) throw new NotFoundException("Restaurant introuvable");
    try { await this.gate.assertAccess(t.id); } catch { throw new NotFoundException("Ce restaurant n'accepte pas de nouveaux comptes pour le moment"); }
    return t;
  }

  // ── Inscription ──

  async signup(slug: string, input: CustomerSignupInput) {
    const tenant = await this.publicTenant(slug);
    const policy = await this.policies.get("tenant", tenant.id);
    this.passwords.assertValid(input.password, policy, input);
    const passwordHash = await this.passwords.hash(input.password);
    let user;
    try {
      user = await this.prisma.asTenant(tenant.id, async (tx) => {
        const exists = await tx.user.findUnique({ where: { tenantId_email: { tenantId: tenant.id, email: input.email } }, select: { id: true } });
        if (exists) throw new ConflictException("Un compte existe déjà avec cet email : connectez-vous ou réinitialisez votre mot de passe");
        const u = await tx.user.create({
          data: {
            tenantId: tenant.id, email: input.email, passwordHash, firstName: input.firstName, lastName: input.lastName,
            phone: input.phone ? normalizePhone(input.phone) : null, role: "CUSTOMER", consentAt: new Date(), passwordChangedAt: new Date(),
            notificationPrefs: DEFAULT_NOTIFICATION_PREFS as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({ data: { tenantId: tenant.id, userId: u.id, action: "customer.signup", entity: "User", entityId: u.id, metadata: {} } });
        return u;
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException("Un compte existe déjà avec cet email : connectez-vous ou réinitialisez votre mot de passe");
      throw e;
    }
    await this.sendVerification(tenant, user);
    return { id: user.id, email: user.email, emailVerificationSent: true };
  }

  // ── Vérification d'email ──

  private async sendVerification(tenant: Pick<Tenant, "id">, u: { id: string; email: string; firstName: string }) {
    const code = String(randomInt(100_000, 1_000_000));
    await this.prisma.asTenant(tenant.id, async (tx) => {
      await tx.emailVerification.deleteMany({ where: { userId: u.id } });
      await tx.emailVerification.create({
        data: { tenantId: tenant.id, userId: u.id, email: u.email, codeHash: codeHash(u.id, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) },
      });
    });
    await this.notifications.send({ channel: "EMAIL", to: u.email, template: "customer.verify-email", data: { firstName: u.firstName, code, minutes: CODE_MINUTES }, tenantId: tenant.id });
  }

  async resendVerification(acc: Account) {
    const u = await this.user(acc);
    if (u.emailVerifiedAt) return { alreadyVerified: true };
    await this.sendVerification({ id: acc.tenantId! }, u);
    return { alreadyVerified: false, sent: true };
  }

  /** Vérifie le code ; l'email confirmé rattache les réservations faites avec cette adresse. */
  async verifyEmail(acc: Account, code: string) {
    const tenantId = acc.tenantId!;
    const linked = await this.prisma.asTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirstOrThrow({ where: { id: acc.id, tenantId } });
      if (u.emailVerifiedAt) return 0;
      const v = await tx.emailVerification.findFirst({ where: { userId: acc.id, email: u.email }, orderBy: { createdAt: "desc" } });
      if (!v || v.expiresAt < new Date() || v.attempts >= MAX_ATTEMPTS) throw new BadRequestException("Ce code a expiré : demandez-en un nouveau");
      if (!same(v.codeHash, codeHash(acc.id, code))) {
        await tx.emailVerification.update({ where: { id: v.id }, data: { attempts: { increment: 1 } } });
        throw new BadRequestException("Code incorrect");
      }
      await tx.user.update({ where: { id: acc.id }, data: { emailVerifiedAt: new Date() } });
      await tx.emailVerification.deleteMany({ where: { userId: acc.id } });
      return this.linkReservations(tx, tenantId, acc.id, u.email);
    });
    return { verified: true, reservationsLinked: linked };
  }

  /** Rattache les réservations (sans compte) faites avec l'email vérifié du client. */
  private async linkReservations(tx: Tx, tenantId: string, userId: string, email: string) {
    const r = await tx.reservation.updateMany({ where: { tenantId, customerId: null, guestEmail: { equals: email, mode: "insensitive" } }, data: { customerId: userId } });
    return r.count;
  }

  // ── Profil et préférences ──

  private async user(acc: Account) {
    const u = await this.prisma.asTenant(acc.tenantId!, (tx) => tx.user.findFirst({ where: { id: acc.id, tenantId: acc.tenantId! } }));
    if (!u) throw new NotFoundException("Compte introuvable");
    return u;
  }

  private profileOf(u: Awaited<ReturnType<CustomersService["user"]>>) {
    return {
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone,
      emailVerified: !!u.emailVerifiedAt, consentAt: u.consentAt, createdAt: u.createdAt,
      notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...((u.notificationPrefs as Partial<NotificationPrefs> | null) ?? {}) },
    };
  }

  async profile(acc: Account) { return this.profileOf(await this.user(acc)); }

  async updateProfile(acc: Account, input: CustomerProfileInput) {
    const tenantId = acc.tenantId!;
    const u = await this.prisma.asTenant(tenantId, (tx) => tx.user.update({
      where: { id: acc.id },
      data: {
        ...(input.firstName ? { firstName: input.firstName } : {}), ...(input.lastName ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone ? normalizePhone(input.phone) : null } : {}),
      },
    }));
    return this.profileOf(u);
  }

  async setPreferences(acc: Account, prefs: NotificationPrefs) {
    const u = await this.prisma.asTenant(acc.tenantId!, (tx) => tx.user.update({ where: { id: acc.id }, data: { notificationPrefs: prefs as Prisma.InputJsonValue } }));
    return this.profileOf(u);
  }

  // ── RGPD ──

  /** Toutes les données du client (profil, réservations, commandes, avis) en JSON. */
  async export(acc: Account) {
    const tenantId = acc.tenantId!;
    const u = await this.user(acc);
    const [reservations, orders, reviews] = await Promise.all([
      this.prisma.asTenant(tenantId, (tx) => tx.reservation.findMany({
        where: { tenantId, customerId: acc.id }, orderBy: { startsAt: "desc" },
        select: { code: true, status: true, source: true, guestName: true, guestEmail: true, guestPhone: true, partySize: true, startsAt: true, endsAt: true, specialRequests: true, createdAt: true, cancelledAt: true },
      })),
      this.prisma.asTenant(tenantId, (tx) => tx.order.findMany({
        where: { tenantId, OR: [{ customerId: acc.id }, { reservation: { customerId: acc.id } }] }, orderBy: { createdAt: "desc" },
        select: { number: true, type: true, status: true, total: true, createdAt: true, closedAt: true, items: { where: { parentItemId: null }, select: { name: true, quantity: true, lineTotal: true } } },
      })),
      this.prisma.asTenant(tenantId, (tx) => tx.feedback.findMany({
        where: { tenantId, customerId: acc.id }, orderBy: { createdAt: "desc" },
        select: { rating: true, comment: true, reply: true, createdAt: true, order: { select: { number: true } } },
      })),
    ]);
    await this.prisma.asTenant(tenantId, (tx) => tx.auditLog.create({ data: { tenantId, userId: acc.id, action: "customer.export", entity: "User", entityId: acc.id, metadata: {} } }));
    return { exportedAt: new Date(), profile: this.profileOf(u), reservations, orders, reviews };
  }

  /**
   * Suppression du compte : les réservations à venir sont annulées ; réservations, commandes et avis sont conservés pour
   * l'historique du restaurant mais anonymisés ; le compte est désactivé et ses données personnelles effacées.
   */
  async deleteAccount(acc: Account, password: string) {
    const tenantId = acc.tenantId!;
    const u = await this.user(acc);
    if (!(await this.passwords.verify(u.passwordHash, password))) throw new UnauthorizedException("Mot de passe incorrect");
    if (u.anonymizedAt) throw new ForbiddenException("Ce compte est déjà supprimé");

    const upcoming = await this.prisma.asTenant(tenantId, (tx) => tx.reservation.findMany({
      where: { tenantId, customerId: acc.id, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gt: new Date() } }, select: { id: true },
    }));
    for (const r of upcoming) await this.reservations.cancel(null, tenantId, r.id, { notifyGuest: false, byGuest: true, reason: "Compte client supprimé" });

    const phone = u.phone ? normalizePhone(u.phone) : null;
    const randomPassword = await argon2.hash(randomBytes(24).toString("base64url"));
    await this.prisma.asTenant(tenantId, async (tx) => {
      const anon = { guestName: "Client supprimé", guestEmail: null, guestPhone: null, specialRequests: null, manageTokenHash: null, customerId: null };
      await tx.reservation.updateMany({ where: { tenantId, customerId: acc.id }, data: anon });
      await tx.reservation.updateMany({ where: { tenantId, customerId: null, guestEmail: { equals: u.email, mode: "insensitive" }, status: { in: ["COMPLETED", "CANCELLED", "NO_SHOW"] } }, data: { guestName: "Client supprimé", guestEmail: null, guestPhone: null, specialRequests: null, manageTokenHash: null } });
      await tx.order.updateMany({ where: { tenantId, customerId: acc.id }, data: { customerId: null, customerName: null, customerPhone: null, trackTokenHash: null } });
      await tx.feedback.updateMany({ where: { tenantId, customerId: acc.id }, data: { customerId: null, authorName: null } });
      await tx.emailVerification.deleteMany({ where: { userId: acc.id } });
      await tx.notificationLog.updateMany({ where: { tenantId, to: { in: [u.email, ...(phone ? [phone] : [])] } }, data: { to: "[supprimé]", subject: null, data: Prisma.DbNull } });
      await tx.user.update({
        where: { id: acc.id },
        data: {
          email: `supprime-${acc.id}@anonyme.invalid`, firstName: "Client", lastName: "supprimé", phone: null, avatarUrl: null, passwordHash: randomPassword,
          isActive: false, anonymizedAt: new Date(), consentAt: null, emailVerifiedAt: null, notificationPrefs: Prisma.DbNull,
          twoFactorEnabled: false, twoFactorSecret: null, recoveryCodeHashes: [],
        },
      });
      await tx.auditLog.create({ data: { tenantId, userId: null, action: "customer.delete", entity: "User", entityId: acc.id, metadata: { reservationsCancelled: upcoming.length } } });
    });
    await this.sessions.revokeAll({ space: "tenant", id: acc.id });
    return { deleted: true };
  }

  // ── Mes commandes, mes avis ──
  orders(acc: Account) { return this.reviews.customerOrders(acc); }
}
