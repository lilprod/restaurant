-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CDI', 'CDD', 'EXTRA', 'INTERN', 'OTHER');

-- AlterTable
ALTER TABLE "Absence" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "status" "AbsenceStatus" NOT NULL DEFAULT 'PENDING';

-- Reprise des anciennes absences : validées si `approved`.
UPDATE "Absence" SET "status" = 'APPROVED' WHERE "approved" = true;
ALTER TABLE "Absence" DROP COLUMN "approved";

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "breakStartedAt" TIMESTAMP(3),
ADD COLUMN     "correctedAt" TIMESTAMP(3),
ADD COLUMN     "correctedById" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SELF';

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "key" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mentions" TEXT[];

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "contractEndsAt" TIMESTAMP(3),
ADD COLUMN     "contractType" "ContractType" NOT NULL DEFAULT 'CDI',
ADD COLUMN     "kioskFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kioskLockedUntil" TIMESTAMP(3),
ADD COLUMN     "kioskPinHash" TEXT,
ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Channel_tenantId_key_key" ON "Channel"("tenantId", "key");

