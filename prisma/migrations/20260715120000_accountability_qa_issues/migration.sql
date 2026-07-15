-- Accountability Migration 2: QaIssue + QAReview accountability columns + CoachingRecord
-- Additive + idempotent.

DO $$ BEGIN
  CREATE TYPE "QaIssueSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FalseConfirmationStatus" AS ENUM ('NONE', 'SUSPECTED', 'CONFIRMED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RectificationStatus" AS ENUM ('PENDING', 'FIXED_BY_QA', 'RETURNED_TO_CLEANER', 'FIXED_BY_OTHER_CLEANER', 'FIXED_BY_MANAGER', 'NOT_FIXED', 'ESCALATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CoachingRecordType" AS ENUM ('COACHING', 'WARNING', 'MANAGEMENT_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CoachingRecordStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ESCALATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- QAReview accountability columns
ALTER TABLE "QAReview" ADD COLUMN IF NOT EXISTS "rawScore" DOUBLE PRECISION;
ALTER TABLE "QAReview" ADD COLUMN IF NOT EXISTS "adjustmentReason" TEXT;
ALTER TABLE "QAReview" ADD COLUMN IF NOT EXISTS "rating" TEXT;
ALTER TABLE "QAReview" ADD COLUMN IF NOT EXISTS "managementReview" BOOLEAN NOT NULL DEFAULT false;

-- QaIssue
CREATE TABLE IF NOT EXISTS "QaIssue" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "cleanerId" TEXT NOT NULL,
  "qaReviewId" TEXT,
  "qaSubmissionId" TEXT,
  "raisedById" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "fieldId" TEXT,
  "itemKey" TEXT,
  "description" TEXT NOT NULL,
  "severity" "QaIssueSeverity" NOT NULL,
  "qaPhotoKeys" JSONB,
  "cleanerMediaIds" JSONB,
  "cleanerMarkedComplete" BOOLEAN NOT NULL DEFAULT false,
  "guestReadyImpact" BOOLEAN NOT NULL DEFAULT false,
  "falseConfirmation" "FalseConfirmationStatus" NOT NULL DEFAULT 'NONE',
  "falseConfReviewedById" TEXT,
  "falseConfReviewedAt" TIMESTAMP(3),
  "rectificationStatus" "RectificationStatus" NOT NULL DEFAULT 'PENDING',
  "rectifiedById" TEXT,
  "rectificationMinutes" INTEGER,
  "rectificationCost" DOUBLE PRECISION,
  "rectificationBeforeKeys" JSONB,
  "rectificationAfterKeys" JSONB,
  "payAdjustmentId" TEXT,
  "escalatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QaIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QaIssue_jobId_idx" ON "QaIssue"("jobId");
CREATE INDEX IF NOT EXISTS "QaIssue_cleanerId_category_createdAt_idx" ON "QaIssue"("cleanerId", "category", "createdAt");
CREATE INDEX IF NOT EXISTS "QaIssue_propertyId_category_createdAt_idx" ON "QaIssue"("propertyId", "category", "createdAt");
CREATE INDEX IF NOT EXISTS "QaIssue_rectificationStatus_idx" ON "QaIssue"("rectificationStatus");
CREATE INDEX IF NOT EXISTS "QaIssue_falseConfirmation_idx" ON "QaIssue"("falseConfirmation");

DO $$ BEGIN
  ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_cleanerId_fkey"
    FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_raisedById_fkey"
    FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_rectifiedById_fkey"
    FOREIGN KEY ("rectifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_qaReviewId_fkey"
    FOREIGN KEY ("qaReviewId") REFERENCES "QAReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CoachingRecord
CREATE TABLE IF NOT EXISTS "CoachingRecord" (
  "id" TEXT NOT NULL,
  "cleanerId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "type" "CoachingRecordType" NOT NULL,
  "status" "CoachingRecordStatus" NOT NULL DEFAULT 'OPEN',
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "issueIds" JSONB,
  "patternKey" TEXT,
  "retrainingRequired" BOOLEAN NOT NULL DEFAULT false,
  "reviewDate" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "outcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoachingRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CoachingRecord_cleanerId_status_idx" ON "CoachingRecord"("cleanerId", "status");
CREATE INDEX IF NOT EXISTS "CoachingRecord_type_status_idx" ON "CoachingRecord"("type", "status");

DO $$ BEGIN
  ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_cleanerId_fkey"
    FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CoachingRecord" ADD CONSTRAINT "CoachingRecord_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: legacy reviews keep score as both raw and final
UPDATE "QAReview" SET "rawScore" = "score" WHERE "rawScore" IS NULL;
