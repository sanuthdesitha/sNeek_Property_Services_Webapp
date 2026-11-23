-- Office amendments of submitted cleaner (payee) invoices (2026-11-23).
-- Additive: three columns with safe defaults on CleanerInvoiceSubmission and a
-- new append-only revision table. Existing rows keep every value.

-- AlterTable
ALTER TABLE "CleanerInvoiceSubmission" ADD COLUMN "amendmentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "amendedAt" TIMESTAMP(3),
ADD COLUMN "xeroOutOfDateSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CleanerInvoiceRevision" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "statusBefore" TEXT NOT NULL,
    "statusAfter" TEXT NOT NULL,
    "beforeLines" JSONB NOT NULL,
    "afterLines" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "beforeTotal" DOUBLE PRECISION NOT NULL,
    "afterTotal" DOUBLE PRECISION NOT NULL,
    "beforeHours" DOUBLE PRECISION NOT NULL,
    "afterHours" DOUBLE PRECISION NOT NULL,
    "xeroBillId" TEXT,
    "notification" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanerInvoiceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CleanerInvoiceRevision_requestKey_key" ON "CleanerInvoiceRevision"("requestKey");

-- CreateIndex
CREATE INDEX "CleanerInvoiceRevision_submissionId_createdAt_idx" ON "CleanerInvoiceRevision"("submissionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CleanerInvoiceRevision_submissionId_revision_key" ON "CleanerInvoiceRevision"("submissionId", "revision");

-- AddForeignKey
ALTER TABLE "CleanerInvoiceRevision" ADD CONSTRAINT "CleanerInvoiceRevision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CleanerInvoiceSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
