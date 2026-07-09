-- Harden the cleaner-invoice payment procedure: capture HOW it was paid and the
-- date the money was actually sent (paidAt stays the record timestamp). Additive
-- and nullable — existing paid submissions keep their paidAmount/paidBankAccount/
-- paidNote/paidAt and simply have no method/paidDate.
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "paidDate" TIMESTAMP(3);
