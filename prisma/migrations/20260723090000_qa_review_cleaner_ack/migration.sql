-- Cleaner-facing QA feedback: when the cleaner acknowledged ("I've read this")
-- the QA review outcome. Null = not yet seen.
ALTER TABLE "QAReview" ADD COLUMN "cleanerAcknowledgedAt" TIMESTAMP(3);
