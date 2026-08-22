-- Barcodes that identify an inventory item.
--
-- MANY per item, deliberately. The same product carries different barcodes
-- across pack sizes, and manufacturers re-issue them on a rebrand, so a single
-- `sku` column cannot express "this bottle and that carton are both the same
-- thing we count".
--
-- `code` is UNIQUE across the whole table and holds the CANONICAL form
-- (GTIN-14, zero-padded) rather than whatever the scanner emitted. A UPC-A
-- label and its EAN-13 equivalent are the same product printed differently;
-- storing them raw files one bottle as two items, which is the single most
-- common way a barcode inventory quietly goes wrong. Canonicalisation lives in
-- lib/inventory/barcodes.ts and runs before anything reaches this table.
--
-- `packSize` exists because scanning a carton must add twelve units, not one.
--
-- ON DELETE CASCADE: a barcode with no item is an unresolvable scan, and
-- keeping it would let a deleted product's label resolve to nothing forever.

CREATE TABLE "ItemBarcode" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "symbology" TEXT,
    "label" TEXT,
    "packSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemBarcode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItemBarcode_code_key" ON "ItemBarcode"("code");
CREATE INDEX "ItemBarcode_itemId_idx" ON "ItemBarcode"("itemId");

ALTER TABLE "ItemBarcode" ADD CONSTRAINT "ItemBarcode_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
