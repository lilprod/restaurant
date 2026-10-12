import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService, Tx } from "../../prisma/prisma.service";

@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    entry: { actorId: string | null; action: string; entity: string; entityId?: string; metadata?: Prisma.InputJsonValue },
    tx: Tx | PrismaService = this.prisma,
  ) {
    return tx.platformAuditLog.create({ data: entry });
  }
}
