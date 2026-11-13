-- Laundry run void (2026-11-14). Additive only: four nullable columns and an
-- index. No existing row changes; a run with voidedAt NULL is not voided.
ALTER TABLE "LaundryTask" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "LaundryTask" ADD COLUMN IF NOT EXISTS "voidedById" TEXT;
ALTER TABLE "LaundryTask" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "LaundryTask" ADD COLUMN IF NOT EXISTS "voidPreviousStatus" "LaundryStatus";

-- A voided run carries who, when and why, and is stored as SKIPPED_PICKUP.
ALTER TABLE "LaundryTask" ADD CONSTRAINT "LaundryTask_void_complete_check"
  CHECK ("voidedAt" IS NULL OR ("voidedById" IS NOT NULL AND "voidReason" IS NOT NULL AND "voidPreviousStatus" IS NOT NULL AND "status" = 'SKIPPED_PICKUP'));

CREATE INDEX IF NOT EXISTS "LaundryTask_voidedAt_idx" ON "LaundryTask"("voidedAt");
