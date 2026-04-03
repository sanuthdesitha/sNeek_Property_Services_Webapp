ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'CARPET_STEAM_CLEAN';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'MOLD_TREATMENT';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'UPHOLSTERY_CLEANING';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'TILE_GROUT_CLEANING';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'GUTTER_CLEANING';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'SPRING_CLEANING';

ALTER TABLE "PriceBook"
  ADD COLUMN IF NOT EXISTS "pricingModel" TEXT,
  ADD COLUMN IF NOT EXISTS "pricingVariables" JSONB;

ALTER TABLE "QuoteLead"
  ADD COLUMN IF NOT EXISTS "requestedServiceLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "promoCode" TEXT,
  ADD COLUMN IF NOT EXISTS "structuredContext" JSONB;

CREATE TABLE IF NOT EXISTS "DiscountCampaign" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
  "discountValue" DOUBLE PRECISION NOT NULL,
  "minSubtotal" DOUBLE PRECISION,
  "jobTypes" JSONB,
  "usageLimit" INTEGER,
  "usageCount" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscountCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiscountCampaign_code_key" ON "DiscountCampaign"("code");

CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tagline" TEXT,
  "description" TEXT,
  "serviceTypes" JSONB,
  "cadenceOptions" JSONB,
  "startingPrice" DOUBLE PRECISION,
  "priceLabel" TEXT,
  "features" JSONB,
  "themeKey" TEXT,
  "ctaLabel" TEXT,
  "ctaHref" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");
