-- Social post generator (2026-11-17). Additive only: new enum values, nullable
-- or defaulted columns on the existing social and image tables (older "post it
-- yourself" posts stay valid), and new tables for the marketing permission
-- register, photo scores, composed posts, publish attempts, connected accounts,
-- OAuth state and reach figures. The new enum values are not used inside this
-- migration (PostgreSQL only allows that after commit).

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUE in one transaction)
ALTER TYPE "SocialChannel" ADD VALUE 'GOOGLE_BUSINESS';
ALTER TYPE "SocialChannel" ADD VALUE 'LINKEDIN';

-- AlterEnum (PostgreSQL 12+ allows several ADD VALUE in one transaction)
ALTER TYPE "SocialPostStatus" ADD VALUE 'SENDING';
ALTER TYPE "SocialPostStatus" ADD VALUE 'SENT_TO_INBOX';
ALTER TYPE "SocialPostStatus" ADD VALUE 'UNCONFIRMED';

-- AlterTable
ALTER TABLE "MarketingAsset" ADD COLUMN     "derivativeKind" TEXT,
ADD COLUMN     "exifStripped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ratio" TEXT,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "socialGroupId" TEXT,
ADD COLUMN     "sourceJobId" TEXT,
ADD COLUMN     "sourcePropertyId" TEXT,
ADD COLUMN     "sourceSecondMediaId" TEXT,
ADD COLUMN     "sourceSubmissionMediaId" TEXT;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryMode" TEXT,
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "networkResponse" JSONB,
ADD COLUMN     "removalDoneAt" TIMESTAMP(3),
ADD COLUMN     "removalDoneById" TEXT,
ADD COLUMN     "removalNeededAt" TIMESTAMP(3),
ADD COLUMN     "socialAccountId" TEXT;

-- AlterTable
ALTER TABLE "SocialPostAsset" ADD COLUMN     "altText" TEXT;

-- CreateTable
CREATE TABLE "MarketingConsent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allowSuburb" BOOLEAN NOT NULL DEFAULT false,
    "allowBefore" BOOLEAN NOT NULL DEFAULT false,
    "method" TEXT NOT NULL,
    "givenByName" TEXT NOT NULL,
    "givenByUserId" TEXT,
    "recordedById" TEXT,
    "evidenceS3Key" TEXT,
    "evidenceNote" TEXT,
    "wordingVersion" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endedVia" TEXT,
    "endedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConsentProperty" (
    "consentId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "MarketingConsentProperty_pkey" PRIMARY KEY ("consentId","propertyId")
);

-- CreateTable
CREATE TABLE "SocialPhotoScore" (
    "id" TEXT NOT NULL,
    "submissionMediaId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "score" INTEGER,
    "components" JSONB,
    "reasons" JSONB,
    "fieldKind" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "laplacianVar" DOUBLE PRECISION,
    "meanLuma" DOUBLE PRECISION,
    "clipLow" DOUBLE PRECISION,
    "clipHigh" DOUBLE PRECISION,
    "contrast" DOUBLE PRECISION,
    "error" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPhotoScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostGroup" (
    "id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdVia" TEXT NOT NULL DEFAULT 'USER',
    "createdById" TEXT,
    "agentActionRequestId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "plannedFor" TIMESTAMP(3),
    "plannedById" TEXT,
    "splitLayout" TEXT,
    "frameKey" TEXT,
    "frameText" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPostGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostGroupPhoto" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "submissionMediaId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'PHOTO',
    "altText" TEXT NOT NULL DEFAULT '',
    "beforeCheckedAt" TIMESTAMP(3),
    "beforeCheckedById" TEXT,

    CONSTRAINT "SocialPostGroupPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPublishAttempt" (
    "id" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "actorId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "externalId" TEXT,
    "externalUrl" TEXT,
    "errorCode" TEXT,
    "reason" TEXT,

    CONSTRAINT "SocialPublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "parentAccountId" TEXT,
    "tokenCiphertext" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "refreshCiphertext" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedById" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "statusReason" TEXT,
    "lastCheckAt" TIMESTAMP(3),
    "lastCheckResult" TEXT,
    "facts" JSONB,
    "disconnectedAt" TIMESTAMP(3),
    "disconnectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialOAuthState" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPostMetric" (
    "id" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,

    CONSTRAINT "SocialPostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingConsent_clientId_endedAt_idx" ON "MarketingConsent"("clientId", "endedAt");

-- CreateIndex
CREATE INDEX "MarketingConsent_endedAt_idx" ON "MarketingConsent"("endedAt");

-- CreateIndex
CREATE INDEX "MarketingConsentProperty_propertyId_idx" ON "MarketingConsentProperty"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPhotoScore_submissionMediaId_key" ON "SocialPhotoScore"("submissionMediaId");

-- CreateIndex
CREATE INDEX "SocialPhotoScore_jobId_idx" ON "SocialPhotoScore"("jobId");

-- CreateIndex
CREATE INDEX "SocialPhotoScore_propertyId_idx" ON "SocialPhotoScore"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostGroup_agentActionRequestId_key" ON "SocialPostGroup"("agentActionRequestId");

-- CreateIndex
CREATE INDEX "SocialPostGroup_status_plannedFor_idx" ON "SocialPostGroup"("status", "plannedFor");

-- CreateIndex
CREATE INDEX "SocialPostGroup_createdAt_idx" ON "SocialPostGroup"("createdAt");

-- CreateIndex
CREATE INDEX "SocialPostGroupPhoto_submissionMediaId_idx" ON "SocialPostGroupPhoto"("submissionMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPostGroupPhoto_groupId_submissionMediaId_key" ON "SocialPostGroupPhoto"("groupId", "submissionMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPublishAttempt_socialPostId_attempt_key" ON "SocialPublishAttempt"("socialPostId", "attempt");

-- CreateIndex
CREATE INDEX "SocialAccount_network_status_idx" ON "SocialAccount"("network", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialOAuthState_stateHash_key" ON "SocialOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "SocialPostMetric_socialPostId_fetchedAt_idx" ON "SocialPostMetric"("socialPostId", "fetchedAt");

-- CreateIndex
CREATE INDEX "MarketingAsset_sourceSubmissionMediaId_idx" ON "MarketingAsset"("sourceSubmissionMediaId");

-- CreateIndex
CREATE INDEX "MarketingAsset_socialGroupId_idx" ON "MarketingAsset"("socialGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_idempotencyKey_key" ON "SocialPost"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SocialPost_groupId_idx" ON "SocialPost"("groupId");

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledFor_idx" ON "SocialPost"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialPostGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConsentProperty" ADD CONSTRAINT "MarketingConsentProperty_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "MarketingConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostGroupPhoto" ADD CONSTRAINT "SocialPostGroupPhoto_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialPostGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPublishAttempt" ADD CONSTRAINT "SocialPublishAttempt_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPostMetric" ADD CONSTRAINT "SocialPostMetric_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The permission register is append-only: no DELETE, and an UPDATE may only
-- end a row that has not ended yet (endedAt, endedById, endedVia, endedReason),
-- leaving every other column as it was. A change of terms ends the old row and
-- creates a new one. Property links never change.
CREATE FUNCTION "marketing_consent_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MarketingConsent rows are never deleted';
  END IF;
  IF OLD."endedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'An ended MarketingConsent row cannot change';
  END IF;
  IF NEW."endedAt" IS NULL
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
    OR NEW."allowSuburb" IS DISTINCT FROM OLD."allowSuburb"
    OR NEW."allowBefore" IS DISTINCT FROM OLD."allowBefore"
    OR NEW."method" IS DISTINCT FROM OLD."method"
    OR NEW."givenByName" IS DISTINCT FROM OLD."givenByName"
    OR NEW."givenByUserId" IS DISTINCT FROM OLD."givenByUserId"
    OR NEW."recordedById" IS DISTINCT FROM OLD."recordedById"
    OR NEW."evidenceS3Key" IS DISTINCT FROM OLD."evidenceS3Key"
    OR NEW."evidenceNote" IS DISTINCT FROM OLD."evidenceNote"
    OR NEW."wordingVersion" IS DISTINCT FROM OLD."wordingVersion"
    OR NEW."givenAt" IS DISTINCT FROM OLD."givenAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'A MarketingConsent row can only be ended, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MarketingConsent_guard"
BEFORE UPDATE OR DELETE ON "MarketingConsent"
FOR EACH ROW EXECUTE FUNCTION "marketing_consent_guard"();

CREATE FUNCTION "marketing_consent_property_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MarketingConsentProperty rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MarketingConsentProperty_append_only"
BEFORE UPDATE OR DELETE ON "MarketingConsentProperty"
FOR EACH ROW EXECUTE FUNCTION "marketing_consent_property_append_only"();
