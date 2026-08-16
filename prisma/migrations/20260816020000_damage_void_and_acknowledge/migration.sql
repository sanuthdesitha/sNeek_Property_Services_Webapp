-- D4 — voiding a damage submission, and the client's sign-off.
--
-- Additive only: one enum, one table, three nullable columns. Nothing existing
-- changes type or nullability, so it is safe to run against a live database
-- with traffic and needs no backfill.
--
-- Reports are never hard-deleted. DamageReportVoid is the audit trail that
-- makes voiding safe — who, when, why, which mode — and for CLEAR_AND_REDO it
-- carries the full snapshot of the items that were cleared, so a cleaner's
-- documented work is archived rather than destroyed.

-- CreateEnum
CREATE TYPE "DamageVoidMode" AS ENUM ('KEEP_AND_REOPEN', 'CLEAR_AND_REDO');

-- AlterTable
ALTER TABLE "DamageReport"
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "acknowledgedById" TEXT,
  ADD COLUMN "acknowledgedName" TEXT;

-- CreateTable
CREATE TABLE "DamageReportVoid" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "mode" "DamageVoidMode" NOT NULL,
    "reason" TEXT NOT NULL,
    "voidedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedItems" JSONB,
    "archivedCaseIds" JSONB,

    CONSTRAINT "DamageReportVoid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DamageReportVoid_reportId_voidedAt_idx" ON "DamageReportVoid"("reportId", "voidedAt");

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: a void record is meaningless without the report it voided.
ALTER TABLE "DamageReportVoid" ADD CONSTRAINT "DamageReportVoid_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DamageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: the audit trail must not lose who performed the void.
ALTER TABLE "DamageReportVoid" ADD CONSTRAINT "DamageReportVoid_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
