-- Accountability Migration 3: CleanerPayAdjustment provenance (source/sourceKey)
-- Additive + idempotent.

ALTER TABLE "CleanerPayAdjustment" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "CleanerPayAdjustment" ADD COLUMN IF NOT EXISTS "sourceKey" TEXT;

CREATE INDEX IF NOT EXISTS "CleanerPayAdjustment_source_sourceKey_idx"
  ON "CleanerPayAdjustment"("source", "sourceKey");
