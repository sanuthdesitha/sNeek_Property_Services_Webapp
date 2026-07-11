-- New "Move-in clean" service.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'MOVE_IN_CLEAN';

-- Quote platform: shareable live link, add-on price visibility, client
-- reference images, and the configurable pricing-variable snapshot. All
-- additive/nullable (showAddOnPrices defaults false).
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "showAddOnPrices" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "referenceImages" JSONB;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "serviceContext" JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS "Quote_publicToken_key" ON "Quote"("publicToken");
