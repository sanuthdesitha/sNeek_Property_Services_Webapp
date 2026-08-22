-- Barcodes we PRINT, alongside the ones manufacturers print.
--
-- The two are genuinely different things, and conflating them causes real
-- damage:
--
--   PRODUCT  the manufacturer's own barcode, scanned off the packaging. That
--            code identifies the product everywhere in the world, and deleting
--            one breaks every future scan of that packaging.
--   LABEL    one we generated and stuck on a shelf. It is ours, it can be
--            pinned to a single property, and removing it is housekeeping.
--
-- `kind` defaults to PRODUCT because every row that exists today came from an
-- admin scanning real packaging. No backfill is needed or wanted.
--
-- `propertyId` is null for a label that works anywhere — the normal case for a
-- product stocked across the portfolio. Set it and the label means "this item,
-- at this property", which is what makes a printed shelf tag unambiguous when
-- the same bottle sits in twelve cupboards.
--
-- ON DELETE CASCADE from Property: a label printed for a property that no
-- longer exists can never resolve to anything useful, and keeping it would let
-- a stray printout point at a dead address.

ALTER TABLE "ItemBarcode" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "ItemBarcode" ADD COLUMN "propertyId" TEXT;

CREATE INDEX "ItemBarcode_propertyId_idx" ON "ItemBarcode"("propertyId");

ALTER TABLE "ItemBarcode" ADD CONSTRAINT "ItemBarcode_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
