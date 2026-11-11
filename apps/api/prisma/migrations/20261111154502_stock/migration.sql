-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('OPEN', 'VALIDATED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Ingredient" ADD COLUMN     "autoDisable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lowAlertedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "RecipeLine" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "stockCountId" TEXT,
ADD COLUMN     "unitCost" INTEGER;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "WasteRecord" ADD COLUMN     "orderItemId" TEXT;

-- CreateTable
CREATE TABLE "OptionRecipeLine" (
    "tenantId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT,

    CONSTRAINT "OptionRecipeLine_pkey" PRIMARY KEY ("optionId","ingredientId")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'OPEN',
    "category" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,
    "varianceCost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "tenantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "countedQty" DECIMAL(12,3),
    "expectedQty" DECIMAL(12,3),
    "varianceCost" INTEGER,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("countId","ingredientId")
);

-- CreateIndex
CREATE INDEX "OptionRecipeLine_tenantId_idx" ON "OptionRecipeLine"("tenantId");

-- CreateIndex
CREATE INDEX "StockCount_tenantId_status_idx" ON "StockCount"("tenantId", "status");

-- CreateIndex
CREATE INDEX "StockCountLine_tenantId_idx" ON "StockCountLine"("tenantId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_orderItemId_idx" ON "StockMovement"("orderItemId");

-- CreateIndex
CREATE INDEX "WasteRecord_tenantId_createdAt_idx" ON "WasteRecord"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "OptionRecipeLine" ADD CONSTRAINT "OptionRecipeLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionRecipeLine" ADD CONSTRAINT "OptionRecipeLine_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionRecipeLine" ADD CONSTRAINT "OptionRecipeLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
