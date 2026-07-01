-- Cleaner-submitted invoices, for admin review + push to Xero as a bill.
CREATE TABLE "CleanerInvoiceSubmission" (
    "id" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobCount" INTEGER NOT NULL DEFAULT 0,
    "lineData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "xeroBillId" TEXT,
    "xeroExportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CleanerInvoiceSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CleanerInvoiceSubmission_cleanerId_idx" ON "CleanerInvoiceSubmission"("cleanerId");
CREATE INDEX "CleanerInvoiceSubmission_status_idx" ON "CleanerInvoiceSubmission"("status");
