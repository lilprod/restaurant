-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "OptionGroup" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "paidAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentStatus" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "serviceCharge" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "lineTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "optionsExtra" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "servedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItemOption" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "change" INTEGER,
ADD COLUMN     "recordedById" TEXT,
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "tendered" INTEGER;

-- AlterTable
ALTER TABLE "RegisterSession" ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "difference" INTEGER,
ADD COLUMN     "expectedCash" INTEGER,
ADD COLUMN     "notes" TEXT;

-- CreateIndex
CREATE INDEX "Order_tenantId_createdAt_idx" ON "Order"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_paymentStatus_idx" ON "Order"("tenantId", "paymentStatus");

-- Référentiel des 14 allergènes à déclaration obligatoire (commun à tous les restaurants, hors RLS).
INSERT INTO "Allergen" ("id", "code", "name") VALUES
  (gen_random_uuid(), 'GLUTEN', 'Gluten'),
  (gen_random_uuid(), 'CRUSTACEANS', 'Crustacés'),
  (gen_random_uuid(), 'EGGS', 'Œufs'),
  (gen_random_uuid(), 'FISH', 'Poisson'),
  (gen_random_uuid(), 'PEANUTS', 'Arachides'),
  (gen_random_uuid(), 'SOY', 'Soja'),
  (gen_random_uuid(), 'MILK', 'Lait'),
  (gen_random_uuid(), 'NUTS', 'Fruits à coque'),
  (gen_random_uuid(), 'CELERY', 'Céleri'),
  (gen_random_uuid(), 'MUSTARD', 'Moutarde'),
  (gen_random_uuid(), 'SESAME', 'Sésame'),
  (gen_random_uuid(), 'SULPHITES', 'Sulfites'),
  (gen_random_uuid(), 'LUPIN', 'Lupin'),
  (gen_random_uuid(), 'MOLLUSCS', 'Mollusques')
ON CONFLICT ("code") DO NOTHING;
