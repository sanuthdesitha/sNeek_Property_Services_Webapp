-- Send a payee's invoice back for correction.
--
-- Until now an admin reviewing a submitted cleaner or QA invoice had two
-- options: mark it paid, or void it. There was nothing between "this is right"
-- and "this is finished with", so a single wrong line meant voiding the whole
-- invoice and hoping the payee worked out what to change.
--
-- CHANGES_REQUESTED is that middle state. It is not a new column — `status` is
-- a plain string — but the note is, because sending an invoice back without
-- saying what is wrong reliably produces the same invoice again.
--
-- Requesting changes RELEASES the work the same way a void now does, so the
-- payee can rebuild and resubmit. That release is application logic
-- (releaseCleanerInvoiceConsumables); these columns only record the ask.
--
-- Additive and nullable: two columns, no backfill, no existing row touched.

ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "changesRequestedAt" TIMESTAMP(3);
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "changesRequestedNote" TEXT;
