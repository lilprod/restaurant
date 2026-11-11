/*
  Warnings:

  - The primary key for the `FormulaItem` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `formulaId` on the `FormulaItem` table. All the data in the column will be lost.
  - Added the required column `stepId` to the `FormulaItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('PERCENT', 'AMOUNT');

-- DropForeignKey
ALTER TABLE "FormulaItem" DROP CONSTRAINT "FormulaItem_formulaId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_menuItemId_fkey";

-- AlterTable
ALTER TABLE "Formula" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "availableFrom" TEXT,
ADD COLUMN     "availableTo" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table inutilisée jusqu'ici (formules non gérées) : on la vide avant de changer sa clé.
DELETE FROM "FormulaItem";

-- AlterTable
ALTER TABLE "FormulaItem" DROP CONSTRAINT "FormulaItem_pkey",
DROP COLUMN "formulaId",
ADD COLUMN     "stepId" TEXT NOT NULL,
ADD CONSTRAINT "FormulaItem_pkey" PRIMARY KEY ("stepId", "menuItemId");

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "formulaId" TEXT,
ADD COLUMN     "parentItemId" TEXT,
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "promotionName" TEXT,
ADD COLUMN     "stepName" TEXT,
ALTER COLUMN "menuItemId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "FormulaStep" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "formulaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minChoices" INTEGER NOT NULL DEFAULT 1,
    "maxChoices" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FormulaStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "menuItemId" TEXT,
    "categoryId" TEXT,
    "startsOn" TEXT,
    "endsOn" TEXT,
    "days" INTEGER[],
    "fromTime" TEXT,
    "toTime" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormulaStep_tenantId_idx" ON "FormulaStep"("tenantId");

-- CreateIndex
CREATE INDEX "FormulaStep_formulaId_idx" ON "FormulaStep"("formulaId");

-- CreateIndex
CREATE INDEX "Promotion_tenantId_idx" ON "Promotion"("tenantId");

-- AddForeignKey
ALTER TABLE "FormulaStep" ADD CONSTRAINT "FormulaStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaStep" ADD CONSTRAINT "FormulaStep_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormulaItem" ADD CONSTRAINT "FormulaItem_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FormulaStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
