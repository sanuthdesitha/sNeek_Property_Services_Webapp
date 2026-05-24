-- Marketing engine — campaign multi-channel + asset library + social posts (idempotent)

-- ── Enums ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'SMS', 'BOTH');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'PAUSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialChannel" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'TIKTOK');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── Extend EmailCampaign ───────────────────────────────
ALTER TABLE "EmailCampaign" ADD COLUMN IF NOT EXISTS "channel" "CampaignChannel" NOT NULL DEFAULT 'EMAIL';
ALTER TABLE "EmailCampaign" ADD COLUMN IF NOT EXISTS "campaignStatus" "CampaignStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "EmailCampaign" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);
ALTER TABLE "EmailCampaign" ADD COLUMN IF NOT EXISTS "templateId" TEXT;

DO $$ BEGIN
  ALTER TABLE "EmailCampaign"
    ADD CONSTRAINT "EmailCampaign_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "EmailCampaign_campaignStatus_scheduledFor_idx"
  ON "EmailCampaign" ("campaignStatus", "scheduledFor");

-- ── MarketingAsset ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MarketingAsset" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "url"          TEXT NOT NULL,
  "s3Key"        TEXT,
  "mediaType"    TEXT NOT NULL,
  "width"        INTEGER,
  "height"       INTEGER,
  "durationSec"  INTEGER,
  "tags"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "description"  TEXT,
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingAsset_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "MarketingAsset"
    ADD CONSTRAINT "MarketingAsset_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "MarketingAsset_mediaType_idx" ON "MarketingAsset" ("mediaType");
CREATE INDEX IF NOT EXISTS "MarketingAsset_createdAt_idx" ON "MarketingAsset" ("createdAt");

-- ── SocialPost ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SocialPost" (
  "id"            TEXT NOT NULL,
  "channel"       "SocialChannel" NOT NULL,
  "status"        "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
  "caption"       TEXT NOT NULL,
  "scheduledFor"  TIMESTAMP(3),
  "publishedAt"   TIMESTAMP(3),
  "externalId"    TEXT,
  "externalUrl"   TEXT,
  "failureReason" TEXT,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SocialPost"
    ADD CONSTRAINT "SocialPost_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "SocialPost_channel_status_idx" ON "SocialPost" ("channel", "status");
CREATE INDEX IF NOT EXISTS "SocialPost_scheduledFor_idx" ON "SocialPost" ("scheduledFor");

-- ── SocialPostAsset ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SocialPostAsset" (
  "socialPostId" TEXT NOT NULL,
  "assetId"      TEXT NOT NULL,
  "order"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SocialPostAsset_pkey" PRIMARY KEY ("socialPostId", "assetId")
);

DO $$ BEGIN
  ALTER TABLE "SocialPostAsset"
    ADD CONSTRAINT "SocialPostAsset_socialPostId_fkey"
    FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SocialPostAsset"
    ADD CONSTRAINT "SocialPostAsset_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "MarketingAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
