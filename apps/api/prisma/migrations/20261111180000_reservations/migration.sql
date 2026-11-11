-- P2A — Réservations : disponibilités, contrainte anti-double-réservation, liste d'attente, fermetures exceptionnelles.
-- Migration autonome : ne touche qu'aux tables des réservations.

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('PHONE', 'WALK_IN', 'ONLINE');

-- AlterEnum
ALTER TYPE "WaitlistStatus" ADD VALUE 'REMOVED';

-- AlterTable (code : rempli pour d'éventuelles lignes existantes, puis obligatoire)
ALTER TABLE "Reservation" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "code" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "manageTokenHash" TEXT,
ADD COLUMN     "noShowAt" TIMESTAMP(3),
ADD COLUMN     "noShowSuggestedAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "seatedAt" TIMESTAMP(3),
ADD COLUMN     "source" "ReservationSource" NOT NULL DEFAULT 'PHONE';
UPDATE "Reservation" SET "code" = upper(substr(md5("id"), 1, 6)) WHERE "code" IS NULL;
ALTER TABLE "Reservation" ALTER COLUMN "code" SET NOT NULL;

-- AlterTable (plage copiée de la réservation pour la contrainte d'exclusion)
ALTER TABLE "ReservationTable" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "startsAt" TIMESTAMP(3);
UPDATE "ReservationTable" rt SET "startsAt" = r."startsAt", "endsAt" = r."endsAt",
  "active" = r."status" IN ('PENDING', 'CONFIRMED', 'SEATED')
  FROM "Reservation" r WHERE r."id" = rt."reservationId";
ALTER TABLE "ReservationTable" ALTER COLUMN "startsAt" SET NOT NULL, ALTER COLUMN "endsAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reservationId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ClosureDay" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosureDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClosureDay_tenantId_idx" ON "ClosureDay"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClosureDay_tenantId_date_key" ON "ClosureDay"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_manageTokenHash_key" ON "Reservation"("manageTokenHash");

-- CreateIndex
CREATE INDEX "Reservation_tenantId_startsAt_idx" ON "Reservation"("tenantId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_tenantId_code_key" ON "Reservation"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ReservationTable_tableId_startsAt_idx" ON "ReservationTable"("tableId", "startsAt");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosureDay" ADD CONSTRAINT "ClosureDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Anti-double-réservation (arbitre final, même en cas de requêtes simultanées) ──
-- Une table ne peut pas être occupée par deux réservations actives sur des plages qui se chevauchent.
-- Les colonnes Prisma sont des `timestamp(3)` (sans fuseau, en UTC) : on utilise `tsrange` (immuable, donc indexable ;
-- `tstzrange` sur ces colonnes exigerait une conversion dépendante du fuseau de session, refusée dans un index).
-- Bornes « [) » : une réservation qui se termine à 20:00 n'empêche pas celle qui commence à 20:00.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_valid_range" CHECK ("endsAt" > "startsAt");
ALTER TABLE "ReservationTable" ADD CONSTRAINT "ReservationTable_no_overlap"
  EXCLUDE USING gist ("tableId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&) WHERE ("active");
