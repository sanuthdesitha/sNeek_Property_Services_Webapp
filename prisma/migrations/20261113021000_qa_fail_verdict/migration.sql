-- QA "Fail" replaces Major and Critical for NEW inspections (owner decision,
-- 2026-11-12). History is not rewritten: no existing QaIssue, QAReview or
-- QaFormSubmission row is updated by this migration.

CREATE TYPE "QaVerdictScale" AS ENUM ('FAIL', 'MAJOR_CRITICAL');

-- New assignments offer Pass / Minor / Fail / N/A.
ALTER TABLE "QaAssignment" ADD COLUMN "verdictScale" "QaVerdictScale" NOT NULL DEFAULT 'FAIL';

-- Inspections already started (in progress, picked up, timer started or a
-- saved draft) or completed keep the options they began with, so they finish
-- and are amended (reopen) on Major / Critical exactly as before.
UPDATE "QaAssignment"
SET "verdictScale" = 'MAJOR_CRITICAL'
WHERE "status" IN ('IN_PROGRESS', 'COMPLETED')
   OR "draft" IS NOT NULL
   OR "pickedUpAt" IS NOT NULL
   OR "onSiteStartedAt" IS NOT NULL;

-- A Fail is stored in the existing severity grouping (Fail = MAJOR,
-- Fail + Serious = CRITICAL) and marked here so screens can say "Fail".
-- Existing rows default to false = recorded on the earlier scale.
ALTER TABLE "QaIssue" ADD COLUMN "failVerdict" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "serious" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_serious_needs_fail" CHECK (NOT "serious" OR "failVerdict");
ALTER TABLE "QaIssue" ADD CONSTRAINT "QaIssue_fail_severity" CHECK (
  NOT "failVerdict"
  OR ("serious" AND "severity" = 'CRITICAL')
  OR (NOT "serious" AND "severity" = 'MAJOR')
);
