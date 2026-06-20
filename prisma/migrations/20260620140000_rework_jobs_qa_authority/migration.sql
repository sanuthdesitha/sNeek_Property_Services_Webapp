-- Rework / reclean jobs + QA review authority
-- Additive only: new nullable columns with safe defaults.

-- ── Job: rework / reclean fields ──────────────────────────────────────────
ALTER TABLE "Job"
  ADD COLUMN "isRework" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reworkOfJobId" TEXT,
  ADD COLUMN "reworkReason" TEXT,
  ADD COLUMN "reworkAreas" JSONB,
  ADD COLUMN "reworkPayAmount" DOUBLE PRECISION,
  ADD COLUMN "reworkPayeeCleanerId" TEXT,
  ADD COLUMN "reworkDeductFromCleanerId" TEXT,
  ADD COLUMN "reworkDeductionApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reworkSourceReviewId" TEXT;

CREATE INDEX "Job_isRework_status_idx" ON "Job" ("isRework", "status");
CREATE INDEX "Job_reworkOfJobId_idx" ON "Job" ("reworkOfJobId");

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_reworkOfJobId_fkey"
  FOREIGN KEY ("reworkOfJobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── QAReview: authority + edit audit ──────────────────────────────────────
ALTER TABLE "QAReview"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'QA',
  ADD COLUMN "editedById" TEXT,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows: reviews with a reviewer were admin/ops quick scores or QA;
-- mark auto-generated (no reviewer) rows as AUTO so they never outrank a real
-- QA inspection going forward.
UPDATE "QAReview" SET "kind" = 'AUTO' WHERE "reviewedById" IS NULL;

CREATE INDEX "QAReview_jobId_kind_createdAt_idx" ON "QAReview" ("jobId", "kind", "createdAt");
