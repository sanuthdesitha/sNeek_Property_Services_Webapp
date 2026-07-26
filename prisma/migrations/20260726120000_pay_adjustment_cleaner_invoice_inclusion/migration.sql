-- Cleaner-invoice settlement marker for pay adjustments.
-- Additive only — no existing column is altered or dropped.
--
-- CleanerPayAdjustment already carries includedInPayrollRunId so a payroll run
-- can never pay the same approved adjustment twice. Cleaner invoices are the
-- second settlement rail and had NO equivalent marker: selection was purely
-- date/job-window based, so an approved addition could be billed by two
-- overlapping invoice periods (double pay) — or, when its job was not on the
-- payee's invoice at all (the QA-inspector credit case), never billed.
--
-- Selection is now: APPROVED AND includedInPayrollRunId IS NULL AND
-- includedInCleanerInvoiceId IS NULL. Existing rows stay NULL = "not yet
-- settled by an invoice", which preserves current behaviour for anything that
-- has already been billed through the job-line path.
ALTER TABLE "CleanerPayAdjustment" ADD COLUMN "includedInCleanerInvoiceId" TEXT;
ALTER TABLE "CleanerPayAdjustment" ADD COLUMN "includedInCleanerInvoiceAt" TIMESTAMP(3);

CREATE INDEX "CleanerPayAdjustment_includedInCleanerInvoiceId_idx"
    ON "CleanerPayAdjustment"("includedInCleanerInvoiceId");
