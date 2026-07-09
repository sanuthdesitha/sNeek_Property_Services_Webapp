-- Proper, auditable payment-recording procedure for CLIENT invoices.
-- Adds a partial-payment status and the payment-detail columns an admin captures
-- when recording a payment (amount received, method, reference, date received).
-- A full per-payment ledger is also appended to ClientInvoice.metadata.payments[].

-- New status: an invoice can be partially settled before it is fully PAID.
ALTER TYPE "ClientInvoiceStatus" ADD VALUE IF NOT EXISTS 'PART_PAID';

-- Payment detail columns (all nullable — additive, no backfill required).
ALTER TABLE "ClientInvoice" ADD COLUMN "paidAmount" DOUBLE PRECISION;
ALTER TABLE "ClientInvoice" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "ClientInvoice" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "ClientInvoice" ADD COLUMN "paidDate" TIMESTAMP(3);
