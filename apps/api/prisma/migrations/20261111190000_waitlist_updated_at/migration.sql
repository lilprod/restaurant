-- Aligne la colonne sur le schéma Prisma (@updatedAt, sans valeur par défaut en base)
ALTER TABLE "WaitlistEntry" ALTER COLUMN "updatedAt" DROP DEFAULT;
