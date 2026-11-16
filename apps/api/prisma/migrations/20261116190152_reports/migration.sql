-- CreateIndex
CREATE INDEX "Order_tenantId_cancelledAt_idx" ON "Order"("tenantId", "cancelledAt");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_status_paidAt_idx" ON "Payment"("tenantId", "status", "paidAt");

-- CreateIndex
CREATE INDEX "RegisterSession_tenantId_openedAt_idx" ON "RegisterSession"("tenantId", "openedAt");
