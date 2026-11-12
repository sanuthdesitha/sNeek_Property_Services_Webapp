-- Laundry partners as suppliers (2026-11-12). Additive and nullable: no data
-- is moved or removed, existing laundry flows read neither column.
--
-- LaundrySupplier.stockSupplierId: the inventory Suppliers list record (stored
-- in AppSetting `inventory_supplier_catalog_v1`, so no FK) for the same
-- business. Unique: one stock supplier links to at most one laundry partner.
ALTER TABLE "LaundrySupplier" ADD COLUMN "stockSupplierId" TEXT;
CREATE UNIQUE INDEX "LaundrySupplier_stockSupplierId_key" ON "LaundrySupplier"("stockSupplierId");

-- User.laundrySupplierId: the laundry partner a LAUNDRY portal user works for.
-- Deleting a partner unlinks its people (SET NULL) and never deletes accounts.
ALTER TABLE "User" ADD COLUMN "laundrySupplierId" TEXT;
CREATE INDEX "User_laundrySupplierId_idx" ON "User"("laundrySupplierId");
ALTER TABLE "User" ADD CONSTRAINT "User_laundrySupplierId_fkey" FOREIGN KEY ("laundrySupplierId") REFERENCES "LaundrySupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
