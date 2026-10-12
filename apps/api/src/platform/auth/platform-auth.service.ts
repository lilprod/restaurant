import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { APP_ENV, Env } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

@Injectable()
export class PlatformAuthService {
  /** Hash factice : on vérifie toujours un mot de passe, même pour un email inconnu (timing). */
  private dummyHash: Promise<string> = argon2.hash("dummy-password-for-timing");

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.platformUser.findUnique({ where: { email: email.toLowerCase() } });
    const ok = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), password).catch(() => false);
    if (!user || !ok || !user.isActive) throw new UnauthorizedException("Email ou mot de passe incorrect");
    return this.issueTokens(user.id, user.role);
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { platformUser: true },
    });
    if (!stored?.platformUser || stored.revokedAt || stored.expiresAt < new Date() || !stored.platformUser.isActive) {
      throw new UnauthorizedException("Session expirée");
    }
    // Rotation : l'ancien jeton est révoqué ; s'il est rejoué, il est refusé.
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new UnauthorizedException("Session expirée");
    return this.issueTokens(stored.platformUser.id, stored.platformUser.role);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(id: string) {
    const u = await this.prisma.platformUser.findUniqueOrThrow({ where: { id } });
    return { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role };
  }

  private async issueTokens(userId: string, role: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId, typ: "platform", role }, { expiresIn: "15m" });
    const refreshToken = randomBytes(48).toString("base64url");
    await this.prisma.refreshToken.create({
      data: {
        platformUserId: userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: 900 };
  }
}
