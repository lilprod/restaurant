/*
  Warnings:

  - Les codes postaux deviennent des quartiers (colonne renommée).

*/
-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DRIVER';

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "codPaymentId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "landmark" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "neighborhood" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pickedUpAt" TIMESTAMP(3),
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledById" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "DeliveryZone" RENAME COLUMN "postalCodes" TO "neighborhoods";
ALTER TABLE "DeliveryZone" ALTER COLUMN "neighborhoods" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "DeliveryZone"
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "etaMinutes" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "landmarks" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryFee" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Delivery_tenantId_status_idx" ON "Delivery"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Delivery_driverId_status_idx" ON "Delivery"("driverId", "status");
