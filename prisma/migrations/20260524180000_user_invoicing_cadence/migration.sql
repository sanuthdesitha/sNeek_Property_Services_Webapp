-- CreateEnum InvoicingCadence (idempotent)
DO $$ BEGIN
  CREATE TYPE "InvoicingCadence" AS ENUM ('ON_COMPLETION', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Extend PayoutMethod with PAYPAL (idempotent)
DO $$ BEGIN
  ALTER TYPE "PayoutMethod" ADD VALUE 'PAYPAL';
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add User invoicing columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invoicingCadence" "InvoicingCadence" NOT NULL DEFAULT 'ON_COMPLETION';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invoiceDayOfWeek" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invoiceDayOfMonth" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "preferredPayoutMethod" "PayoutMethod" NOT NULL DEFAULT 'MANUAL_BANK_TRANSFER';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastInvoiceGeneratedAt" TIMESTAMP(3);
