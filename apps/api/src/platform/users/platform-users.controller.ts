import { Body, ConflictException, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ZodPipe } from "../../common/zod.pipe";
import { PrismaService } from "../../prisma/prisma.service";
import { AccountAdminService } from "../../security/account-admin.service";
import { PasswordService } from "../../security/password.service";
import { SecurityPolicyService } from "../../security/security-policy.service";
import { CurrentPlatformUser, PlatformAuthGuard, PlatformPrincipal, PlatformRoles } from "../auth/platform-auth.guard";

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  role: z.enum(["SUPER_ADMIN", "SUPPORT"]),
});
const updateUserSchema = z.object({ role: z.enum(["SUPER_ADMIN", "SUPPORT"]).optional(), isActive: z.boolean().optional() });

const view = (u: { id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean; twoFactorEnabled: boolean; lockedUntil: Date | null; lastLoginAt: Date | null }) => ({
  id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, isActive: u.isActive,
  twoFactorEnabled: u.twoFactorEnabled, locked: !!u.lockedUntil && u.lockedUntil > new Date(), lastLoginAt: u.lastLoginAt,
});

/** Équipe de la plateforme (SuperAdmin et Support) : création, rôles, activation, réinitialisation. */
@ApiTags("Plateforme · Équipe")
@ApiBearerAuth()
@UseGuards(PlatformAuthGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("platform/users")
export class PlatformUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AccountAdminService,
    private readonly passwords: PasswordService,
    private readonly policies: SecurityPolicyService,
  ) {}

  @Get()
  async list() {
    return (await this.prisma.platformUser.findMany({ orderBy: { createdAt: "asc" } })).map(view);
  }

  /** Crée le compte avec un mot de passe temporaire (affiché une seule fois) à changer à la première connexion. */
  @Post()
  async create(@Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>, @CurrentPlatformUser() me: PlatformPrincipal) {
    const policy = await this.policies.get("platform");
    const temporaryPassword = this.passwords.generateTemporary(policy);
    const user = await this.prisma.platformUser.create({
      data: { ...body, email: body.email.toLowerCase(), passwordHash: await this.passwords.hash(temporaryPassword), mustChangePassword: true, passwordChangedAt: new Date() },
    });
    await this.prisma.platformAuditLog.create({ data: { actorId: me.id, action: "platform_user.create", entity: "PlatformUser", entityId: user.id } });
    return { ...view(user), temporaryPassword };
  }

  @Patch(":id")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>, @CurrentPlatformUser() me: PlatformPrincipal) {
    if (id === me.id && (body.isActive === false || (body.role && body.role !== me.role))) {
      throw new ConflictException("Vous ne pouvez pas modifier votre propre rôle ou votre activation");
    }
    if (body.isActive !== undefined) await this.admin.setActive("platform", null, id, body.isActive, { kind: "platform", id: me.id });
    if (body.role) await this.prisma.platformUser.update({ where: { id }, data: { role: body.role } });
    return view(await this.prisma.platformUser.findUniqueOrThrow({ where: { id } }));
  }

  @Post(":id/reset-password") @HttpCode(200)
  reset(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformUser() me: PlatformPrincipal) {
    return this.admin.resetPassword("platform", null, id, { kind: "platform", id: me.id });
  }
  @Post(":id/unlock") @HttpCode(200)
  unlock(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformUser() me: PlatformPrincipal) {
    return this.admin.unlock("platform", null, id, { kind: "platform", id: me.id });
  }
  @Post(":id/disable-2fa") @HttpCode(200)
  disable2fa(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformUser() me: PlatformPrincipal) {
    return this.admin.disableTwoFactor("platform", null, id, { kind: "platform", id: me.id });
  }
  @Post(":id/revoke-sessions") @HttpCode(200)
  revoke(@Param("id", ParseUUIDPipe) id: string, @CurrentPlatformUser() me: PlatformPrincipal) {
    return this.admin.revokeSessions("platform", null, id, { kind: "platform", id: me.id });
  }
}
