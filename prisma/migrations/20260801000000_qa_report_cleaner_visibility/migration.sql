-- QA report visibility for cleaners.
--
-- Mirrors Report."cleanerVisible" for the job report. Defaults to true because
-- the QA report route already permitted Role.CLEANER (with an assignment check)
-- before this column existed — the toggle adds admin control, it does not
-- newly open access. Existing rows therefore keep today's behaviour.
ALTER TABLE "QAReview"
  ADD COLUMN IF NOT EXISTS "cleanerReportVisible" BOOLEAN NOT NULL DEFAULT true;
