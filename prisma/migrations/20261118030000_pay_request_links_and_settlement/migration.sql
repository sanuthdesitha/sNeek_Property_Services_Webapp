-- Pay requests: link to a job, settle outside the system, and bill to the client.
-- Additive only. Every existing row keeps billToClient = false and no markers,
-- so it behaves exactly as before.

-- AlterTable
ALTER TABLE "CleanerPayAdjustment" ADD COLUMN     "billToClient" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clientAmount" DOUBLE PRECISION,
ADD COLUMN     "clientBilledAmount" DOUBLE PRECISION,
ADD COLUMN     "clientBilledAt" TIMESTAMP(3),
ADD COLUMN     "clientBilledText" TEXT,
ADD COLUMN     "clientBillingDecidedAt" TIMESTAMP(3),
ADD COLUMN     "clientBillingDecidedById" TEXT,
ADD COLUMN     "clientDescription" TEXT,
ADD COLUMN     "clientInvoiceLineId" TEXT,
ADD COLUMN     "jobLinkedAt" TIMESTAMP(3),
ADD COLUMN     "jobLinkedById" TEXT,
ADD COLUMN     "paidOutsideAt" TIMESTAMP(3),
ADD COLUMN     "paidOutsideById" TEXT,
ADD COLUMN     "paidOutsideDate" DATE,
ADD COLUMN     "paidOutsideMethod" TEXT,
ADD COLUMN     "paidOutsideNote" TEXT,
ADD COLUMN     "paidOutsideReference" TEXT;

-- CreateIndex
CREATE INDEX "CleanerPayAdjustment_clientInvoiceLineId_idx" ON "CleanerPayAdjustment"("clientInvoiceLineId");

-- CreateIndex
CREATE INDEX "CleanerPayAdjustment_billToClient_status_idx" ON "CleanerPayAdjustment"("billToClient", "status");

-- AddForeignKey
ALTER TABLE "CleanerPayAdjustment" ADD CONSTRAINT "CleanerPayAdjustment_clientInvoiceLineId_fkey" FOREIGN KEY ("clientInvoiceLineId") REFERENCES "ClientInvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

