-- D3 — a damage report is separately verifiable from the clean it came from.
--
-- ReportVerification was one-code-per-job: `jobId` was UNIQUE and there was no
-- discriminator, so a damage PDF could not carry its own /verify code at all.
--
-- Shape after this migration:
--   CLEANING row -> jobId set, damageReportId NULL   (one per job, as before)
--   DAMAGE   row -> jobId NULL, damageReportId set   (one per damage report)
--
-- The composite UNIQUE (jobId, kind) preserves the old one-per-job guarantee
-- for CLEANING. DAMAGE rows leave jobId NULL and Postgres treats NULLs as
-- distinct, so a job with several damage reports gets a code for each; their
-- uniqueness is carried by the UNIQUE on damageReportId instead.
--
-- Backfill-free: every existing row is a cleaning verification with a jobId, so
-- the DEFAULT 'CLEANING' is already correct for all of them and none can
-- violate the new composite unique.

-- CreateEnum
CREATE TYPE "ReportVerificationKind" AS ENUM ('CLEANING', 'DAMAGE');

-- AlterTable
ALTER TABLE "ReportVerification"
  ADD COLUMN "kind" "ReportVerificationKind" NOT NULL DEFAULT 'CLEANING',
  ADD COLUMN "damageReportId" TEXT,
  ALTER COLUMN "jobId" DROP NOT NULL;

-- DropIndex
-- Replaced by the composite below; dropping it is what allows more than one
-- verification row to reference the same job (one cleaning + N damage).
DROP INDEX "ReportVerification_jobId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ReportVerification_damageReportId_key" ON "ReportVerification"("damageReportId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportVerification_jobId_kind_key" ON "ReportVerification"("jobId", "kind");

-- AddForeignKey
ALTER TABLE "ReportVerification" ADD CONSTRAINT "ReportVerification_damageReportId_fkey" FOREIGN KEY ("damageReportId") REFERENCES "DamageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
