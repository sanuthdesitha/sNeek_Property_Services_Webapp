-- Record payment settlement details when an admin marks a cleaner invoice paid.
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "paidAmount" DOUBLE PRECISION;
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "paidBankAccount" TEXT;
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "paidNote" TEXT;
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "paidAt" TIMESTAMP(3);
