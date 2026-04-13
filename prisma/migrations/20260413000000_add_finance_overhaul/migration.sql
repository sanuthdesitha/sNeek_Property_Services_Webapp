-- Migration: add_finance_overhaul
-- Created: 2026-04-13

-- Add new enums (safe: IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'VOID');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutMethod" AS ENUM ('STRIPE_CONNECT', 'ABA_FILE', 'MANUAL_BANK_TRANSFER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "GatewayProvider" AS ENUM ('STRIPE', 'PAYPAL', 'SQUARE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "GatewayStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TEST');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationRecipientRole" AS ENUM ('ADMIN', 'CLEANER', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationLogStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Extend User table (safe: IF NOT EXISTS)
DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "bankBsb" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "bankAccountNumber" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "bankAccountName" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD COLUMN "stripeAccountId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Extend Client table
DO $$ BEGIN
  ALTER TABLE "Client" ADD COLUMN "xeroContactId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Client" ADD COLUMN "xeroSyncedAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Extend ClientInvoice table
DO $$ BEGIN
  ALTER TABLE "ClientInvoice" ADD COLUMN "gstEnabled" BOOLEAN NOT NULL DEFAULT true;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientInvoice" ADD COLUMN "xeroExportedAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientInvoice" ADD COLUMN "xeroInvoiceId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientInvoice" ADD COLUMN "sentAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientInvoice" ADD COLUMN "paidAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientInvoice" ADD COLUMN "stripePaymentIntentId" TEXT;
EXCEPTION WHEN duplicate_column THEN null;
END $$;

-- Create PayrollRun table (safe: IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS "PayrollRun" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totalPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalShoppingReimbursements" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTransportAllowances" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAdjustments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cleanerCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- Create Payout table
CREATE TABLE IF NOT EXISTS "Payout" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "shoppingReimbursement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transportAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjustments" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PayoutMethod" NOT NULL DEFAULT 'MANUAL_BANK_TRANSFER',
    "stripeAccountId" TEXT,
    "stripePayoutId" TEXT,
    "bankBsb" TEXT,
    "bankAccountNumber" TEXT,
    "bankAccountName" TEXT,
    "abaReference" TEXT,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- Create PaymentGateway table
CREATE TABLE IF NOT EXISTS "PaymentGateway" (
    "id" TEXT NOT NULL,
    "provider" "GatewayProvider" NOT NULL,
    "status" "GatewayStatus" NOT NULL DEFAULT 'ACTIVE',
    "label" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "credentials" JSONB NOT NULL,
    "feeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fixedFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "surchargeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("id")
);

-- Create ClientPayment table
CREATE TABLE IF NOT EXISTS "ClientPayment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT,
    "quoteId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gatewayId" TEXT NOT NULL,
    "gatewayProvider" "GatewayProvider" NOT NULL,
    "gatewayPaymentId" TEXT,
    "gatewayResponse" JSONB,
    "feeAmount" DOUBLE PRECISION,
    "surchargeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundAmount" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

-- Create XeroConnection table
CREATE TABLE IF NOT EXISTS "XeroConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XeroConnection_pkey" PRIMARY KEY ("id")
);

-- Create NotificationTemplate table
CREATE TABLE IF NOT EXISTS "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "emailSubject" TEXT,
    "emailBodyHtml" TEXT,
    "emailBodyText" TEXT,
    "smsBody" TEXT,
    "pushTitle" TEXT,
    "pushBody" TEXT,
    "availableVars" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- Create NotificationPreference table
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "recipientRole" "NotificationRecipientRole" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- Create NotificationLog table
CREATE TABLE IF NOT EXISTS "NotificationLog" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientRole" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationLogStatus" NOT NULL,
    "subject" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- Create indexes (safe: IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "PayrollRun_status_createdAt_idx" ON "PayrollRun"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "PayrollRun_periodStart_periodEnd_idx" ON "PayrollRun"("periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "Payout_payrollRunId_status_idx" ON "Payout"("payrollRunId", "status");
CREATE INDEX IF NOT EXISTS "Payout_cleanerId_status_idx" ON "Payout"("cleanerId", "status");
CREATE INDEX IF NOT EXISTS "PaymentGateway_status_priority_idx" ON "PaymentGateway"("status", "priority");
CREATE INDEX IF NOT EXISTS "ClientPayment_invoiceId_status_idx" ON "ClientPayment"("invoiceId", "status");
CREATE INDEX IF NOT EXISTS "ClientPayment_gatewayId_status_idx" ON "ClientPayment"("gatewayId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "XeroConnection_tenantId_key" ON "XeroConnection"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationTemplate_eventKey_key" ON "NotificationTemplate"("eventKey");
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_eventKey_recipientRole_channel_key" ON "NotificationPreference"("eventKey", "recipientRole", "channel");
CREATE INDEX IF NOT EXISTS "NotificationPreference_eventKey_idx" ON "NotificationPreference"("eventKey");
CREATE INDEX IF NOT EXISTS "NotificationLog_eventKey_createdAt_idx" ON "NotificationLog"("eventKey", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_recipientEmail_createdAt_idx" ON "NotificationLog"("recipientEmail", "createdAt");

-- Add foreign keys (safe: check constraint existence first)
DO $$ BEGIN
  ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Payout" ADD CONSTRAINT "Payout_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "Payout" ADD CONSTRAINT "Payout_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClientInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientPayment" ADD CONSTRAINT "ClientPayment_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "PaymentGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
