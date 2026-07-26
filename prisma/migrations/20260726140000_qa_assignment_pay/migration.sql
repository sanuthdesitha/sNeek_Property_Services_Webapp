-- QA inspection pay. Additive only — no existing column is altered or dropped.
--
-- QA inspections were unpaid work in the data model: an inspector could be
-- assigned, drive to a property, run a full inspection and there was nowhere to
-- record what they were owed. Cleaners have Job.estimatedHours ×
-- (JobAssignment.payRate | User.hourlyRate | job-type rate), plus a per-job
-- custom payout. These columns are the QA equivalent, on the assignment because
-- the assignment IS the unit of QA work.
--
-- Money columns are DOUBLE PRECISION to match every other money column in this
-- schema (CleanerPayAdjustment.requestedAmount, User.hourlyRate, Job.fixedPrice).
--
-- Precedence resolved by lib/finance/qa-pay.ts:
--   mode   : payMode -> settings.qaPay.defaultMode
--   fixed  : payAmount -> settings.qaPay.defaultFixedAmount
--   rate   : payHourlyRate -> User.hourlyRate -> settings.qaPay.defaultHourlyRate
--   hours  : payHoursAllocated -> actual on-site hours -> settings default
ALTER TABLE "QaAssignment" ADD COLUMN "payMode" TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN "payAmount" DOUBLE PRECISION;
ALTER TABLE "QaAssignment" ADD COLUMN "payHourlyRate" DOUBLE PRECISION;
ALTER TABLE "QaAssignment" ADD COLUMN "payHoursAllocated" DOUBLE PRECISION;
ALTER TABLE "QaAssignment" ADD COLUMN "payNote" TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN "paySettledAmount" DOUBLE PRECISION;

-- Settlement stamps. Same double-pay discipline as CleanerPayAdjustment: an
-- inspection is money owed exactly once, and a row carrying EITHER stamp is
-- spent. Existing rows stay NULL = "never settled", which is correct: no QA
-- inspection has ever been paid through either rail before this migration.
ALTER TABLE "QaAssignment" ADD COLUMN "includedInPayrollRunId" TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN "includedInPayrollRunAt" TIMESTAMP(3);
ALTER TABLE "QaAssignment" ADD COLUMN "includedInCleanerInvoiceId" TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN "includedInCleanerInvoiceAt" TIMESTAMP(3);

CREATE INDEX "QaAssignment_includedInPayrollRunId_idx"
    ON "QaAssignment"("includedInPayrollRunId");
CREATE INDEX "QaAssignment_includedInCleanerInvoiceId_idx"
    ON "QaAssignment"("includedInCleanerInvoiceId");
