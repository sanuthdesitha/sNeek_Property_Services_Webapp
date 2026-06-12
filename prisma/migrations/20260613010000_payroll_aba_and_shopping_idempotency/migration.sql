-- ABA file regeneration guard.
ALTER TABLE "PayrollRun" ADD COLUMN "abaGeneratedAt" TIMESTAMP(3);
ALTER TABLE "PayrollRun" ADD COLUMN "abaGeneratedById" TEXT;

-- Shopping-reimbursement payroll idempotency (consumed marker).
ALTER TABLE "ShoppingSettlement" ADD COLUMN "includedInPayrollRunId" TEXT;
CREATE INDEX "ShoppingSettlement_includedInPayrollRunId_idx" ON "ShoppingSettlement"("includedInPayrollRunId");
