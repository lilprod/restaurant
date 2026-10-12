-- Isolation multi-tenant par Row Level Security (PostgreSQL).
-- À appliquer APRÈS `prisma migrate` (voir README). Fichier généré : une section par table scopée.
--
-- Principe : chaque requête tenant ouvre une transaction et exécute
--   SELECT set_config('app.tenant_id', '<uuid>', true);
-- Les opérations plateforme (SuperAdmin) utilisent
--   SELECT set_config('app.bypass_rls', 'on', true);
-- Le rôle SQL de l'application ne doit PAS être superuser (il contournerait RLS).

CREATE OR REPLACE FUNCTION app_tenant_ok(row_tenant text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.bypass_rls', true) = 'on'
      OR row_tenant = current_setting('app.tenant_id', true)
$$;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "FloorPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FloorPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FloorPlan";
CREATE POLICY tenant_isolation ON "FloorPlan"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "RestaurantTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RestaurantTable" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RestaurantTable";
CREATE POLICY tenant_isolation ON "RestaurantTable"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Reservation";
CREATE POLICY tenant_isolation ON "Reservation"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "ReservationTable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReservationTable" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReservationTable";
CREATE POLICY tenant_isolation ON "ReservationTable"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "WaitlistEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WaitlistEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WaitlistEntry";
CREATE POLICY tenant_isolation ON "WaitlistEntry"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "OpeningHours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpeningHours" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OpeningHours";
CREATE POLICY tenant_isolation ON "OpeningHours"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Category" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Category";
CREATE POLICY tenant_isolation ON "Category"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "MenuItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MenuItem";
CREATE POLICY tenant_isolation ON "MenuItem"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "MenuItemAllergen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuItemAllergen" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MenuItemAllergen";
CREATE POLICY tenant_isolation ON "MenuItemAllergen"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "OptionGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OptionGroup" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OptionGroup";
CREATE POLICY tenant_isolation ON "OptionGroup"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Option" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Option" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Option";
CREATE POLICY tenant_isolation ON "Option"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Formula" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Formula" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Formula";
CREATE POLICY tenant_isolation ON "Formula"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "FormulaItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormulaItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FormulaItem";
CREATE POLICY tenant_isolation ON "FormulaItem"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Order";
CREATE POLICY tenant_isolation ON "Order"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OrderItem";
CREATE POLICY tenant_isolation ON "OrderItem"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "OrderItemOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItemOption" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OrderItemOption";
CREATE POLICY tenant_isolation ON "OrderItemOption"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PaymentAllocation";
CREATE POLICY tenant_isolation ON "PaymentAllocation"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "RegisterSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegisterSession" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RegisterSession";
CREATE POLICY tenant_isolation ON "RegisterSession"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "DeliveryZone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeliveryZone" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DeliveryZone";
CREATE POLICY tenant_isolation ON "DeliveryZone"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Delivery" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Delivery";
CREATE POLICY tenant_isolation ON "Delivery"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Ingredient";
CREATE POLICY tenant_isolation ON "Ingredient"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "RecipeLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecipeLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RecipeLine";
CREATE POLICY tenant_isolation ON "RecipeLine"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "StockMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StockMovement";
CREATE POLICY tenant_isolation ON "StockMovement"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "WasteRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WasteRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WasteRecord";
CREATE POLICY tenant_isolation ON "WasteRecord"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Supplier";
CREATE POLICY tenant_isolation ON "Supplier"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PurchaseOrder";
CREATE POLICY tenant_isolation ON "PurchaseOrder"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PurchaseOrderLine";
CREATE POLICY tenant_isolation ON "PurchaseOrderLine"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "StaffProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StaffProfile";
CREATE POLICY tenant_isolation ON "StaffProfile"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Shift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shift" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Shift";
CREATE POLICY tenant_isolation ON "Shift"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Attendance";
CREATE POLICY tenant_isolation ON "Attendance"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Absence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Absence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Absence";
CREATE POLICY tenant_isolation ON "Absence"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Channel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Channel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Channel";
CREATE POLICY tenant_isolation ON "Channel"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "ChannelMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChannelMember" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChannelMember";
CREATE POLICY tenant_isolation ON "ChannelMember"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Message";
CREATE POLICY tenant_isolation ON "Message"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Feedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Feedback";
CREATE POLICY tenant_isolation ON "Feedback"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Setting" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Setting";
CREATE POLICY tenant_isolation ON "Setting"
  USING (app_tenant_ok("tenantId")) WITH CHECK (app_tenant_ok("tenantId"));

-- TODO (phase réservations) : empêcher qu'une même table soit réservée sur deux plages
-- qui se chevauchent, via une contrainte EXCLUDE USING gist (extension btree_gist) ;
-- cela suppose de dénormaliser la plage horaire (tstzrange) sur ReservationTable.
