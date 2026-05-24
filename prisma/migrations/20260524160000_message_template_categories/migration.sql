-- Create enum (idempotent)
DO $$ BEGIN
  CREATE TYPE "MessageCategory" AS ENUM (
    'CHASE', 'MARKETING', 'OPERATIONAL', 'SERVICE_RECOVERY',
    'FEEDBACK', 'COMPLAINT', 'ONBOARDING', 'CLEANER_FACING',
    'LAUNDRY_FACING', 'INTERNAL', 'CUSTOM'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add columns to MessageTemplate
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "category" "MessageCategory" NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "variables" JSONB;

-- Drop NOT NULL on triggerType (now has default) — only if it doesn't already have a default
DO $$ BEGIN
  ALTER TABLE "MessageTemplate" ALTER COLUMN "triggerType" SET DEFAULT 'MANUAL';
EXCEPTION WHEN others THEN null; END $$;

-- Index for category lookups
CREATE INDEX IF NOT EXISTS "MessageTemplate_category_isActive_idx" ON "MessageTemplate"("category", "isActive");
