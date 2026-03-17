ALTER TABLE "InventoryItem"
ADD COLUMN "location" TEXT NOT NULL DEFAULT 'CLEANERS_CUPBOARD';

UPDATE "InventoryItem"
SET "location" = CASE
  WHEN LOWER(COALESCE("category", '')) LIKE '%bath%' THEN 'BATHROOM'
  WHEN LOWER(COALESCE("category", '')) LIKE '%kitchen%' THEN 'KITCHEN'
  WHEN LOWER(COALESCE("category", '')) LIKE '%clean%' THEN 'CLEANERS_CUPBOARD'
  ELSE "location"
END;
