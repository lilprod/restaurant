import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";

/** Traduit les erreurs Prisma courantes en réponses HTTP lisibles. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e.code === "P2002") {
      return res.status(HttpStatus.CONFLICT).json({ statusCode: 409, message: "Cette valeur est déjà utilisée", fields: e.meta?.target });
    }
    if (e.code === "P2025") {
      return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, message: "Ressource introuvable" });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: "Erreur interne" });
  }
}
