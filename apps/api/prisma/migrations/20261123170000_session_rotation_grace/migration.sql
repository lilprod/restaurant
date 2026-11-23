-- Délai de grâce de rotation du jeton de rafraîchissement (réponse perdue) et détection de réutilisation (voir SessionService.rotate)
-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "previousTokenHash" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_previousTokenHash_key" ON "RefreshToken"("previousTokenHash");

