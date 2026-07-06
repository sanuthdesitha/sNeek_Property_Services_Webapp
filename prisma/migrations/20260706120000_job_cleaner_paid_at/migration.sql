-- Cleaner-invoice payment stamp on Job (parallel to payrollRunId).
ALTER TABLE "Job" ADD COLUMN "cleanerPaidAt" TIMESTAMP(3);
