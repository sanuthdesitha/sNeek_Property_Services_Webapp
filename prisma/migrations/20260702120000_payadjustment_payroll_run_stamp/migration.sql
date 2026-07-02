-- Payroll idempotency for approved pay adjustments: stamp the run that paid an
-- adjustment so it can never be included in a second run. Additive + nullable.

-- AlterTable
ALTER TABLE "CleanerPayAdjustment" ADD COLUMN "includedInPayrollRunId" TEXT;

-- CreateIndex
CREATE INDEX "CleanerPayAdjustment_includedInPayrollRunId_idx" ON "CleanerPayAdjustment"("includedInPayrollRunId");
