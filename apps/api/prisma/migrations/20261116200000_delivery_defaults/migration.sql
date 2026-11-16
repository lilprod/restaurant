-- Aligne les colonnes sur le schéma Prisma (pas de valeur par défaut en base)
ALTER TABLE "Delivery" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "DeliveryZone" ALTER COLUMN "neighborhoods" DROP DEFAULT;
ALTER TABLE "DeliveryZone" ALTER COLUMN "landmarks" DROP DEFAULT;
