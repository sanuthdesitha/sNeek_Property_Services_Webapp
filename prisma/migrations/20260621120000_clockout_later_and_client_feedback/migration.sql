-- Gated clock-out-before-form + richer client feedback (additive).

ALTER TABLE "Job"
  ADD COLUMN "formPendingAfterClockOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clockedOutEarlyAt" TIMESTAMP(3);

ALTER TABLE "JobFeedback"
  ADD COLUMN "cleanlinessRating" INTEGER,
  ADD COLUMN "communicationRating" INTEGER,
  ADD COLUMN "valueRating" INTEGER,
  ADD COLUMN "wouldRecommend" BOOLEAN;
