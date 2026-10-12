import { Injectable } from "@nestjs/common";
import { LoginResult, Prisma } from "@prisma/client";
import type { RequestMeta } from "../common/request-meta";
import { PrismaService } from "../prisma/prisma.service";
import type { Space } from "./accounts.repo";

@Injectable()
export class LoginEventsService {
  constructor(private readonly prisma: PrismaService) {}

  record(args: { space: Space; tenantId?: string | null; accountId?: string | null; email: string; result: LoginResult; meta: RequestMeta }) {
    return this.prisma.loginEvent.create({
      data: {
        space: args.space,
        tenantId: args.tenantId ?? null,
        userId: args.space === "tenant" ? args.accountId ?? null : null,
        platformUserId: args.space === "platform" ? args.accountId ?? null : null,
        email: args.email.toLowerCase().slice(0, 200),
        result: args.result,
        ip: args.meta.ip,
        userAgent: args.meta.userAgent,
      },
    });
  }

  list(where: Prisma.LoginEventWhereInput, limit = 50) {
    return this.prisma.loginEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(limit, 200) });
  }
}
