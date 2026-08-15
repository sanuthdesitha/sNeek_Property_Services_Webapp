-- D1 — damage reporting: one report per submission, many items, one case per item.
--
-- Hand-written rather than generated. `prisma migrate diff` against the dev
-- database also proposed dropping RenderedDocument, TemplateDefinition,
-- TemplateVersion and TemplateVersionStatus. Those tables exist only in the dev
-- copy — no committed migration ever created them — so they are local drift,
-- not schema history. Including the drops would have destroyed three tables on
-- live. Only the damage DDL belongs here.
--
-- Additive and reversible: creates four enums and three tables, touches nothing
-- that already exists. Safe to run on a live database with traffic.

-- CreateEnum
CREATE TYPE "DamageReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR', 'SEVERE');

-- CreateEnum
CREATE TYPE "DamageSuspectedCause" AS ENUM ('GUEST', 'WEAR', 'UNKNOWN', 'PRE_EXISTING');

-- CreateEnum
CREATE TYPE "DamagePhotoSection" AS ENUM ('OVERVIEW', 'CLOSE_UP', 'CONTEXT', 'EVIDENCE');

-- CreateTable
CREATE TABLE "DamageReport" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "status" "DamageReportStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "caseId" TEXT,
    "area" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "DamageSeverity" NOT NULL DEFAULT 'MODERATE',
    "description" TEXT NOT NULL,
    "suspectedCause" "DamageSuspectedCause" NOT NULL DEFAULT 'UNKNOWN',
    "estimatedCost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DamageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DamageItemPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "annotatedKey" TEXT,
    "flatKey" TEXT,
    "caption" TEXT,
    "section" "DamagePhotoSection" NOT NULL DEFAULT 'OVERVIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DamageItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DamageReport_jobId_idx" ON "DamageReport"("jobId");

-- CreateIndex
CREATE INDEX "DamageReport_propertyId_status_idx" ON "DamageReport"("propertyId", "status");

-- CreateIndex
CREATE INDEX "DamageReport_status_submittedAt_idx" ON "DamageReport"("status", "submittedAt");

-- CreateIndex
-- Unique, not just indexed: two damage items sharing one case would make CP-7
-- raise a single repair for two separate faults.
CREATE UNIQUE INDEX "DamageItem_caseId_key" ON "DamageItem"("caseId");

-- CreateIndex
CREATE INDEX "DamageItem_reportId_idx" ON "DamageItem"("reportId");

-- CreateIndex
CREATE INDEX "DamageItemPhoto_itemId_section_idx" ON "DamageItemPhoto"("itemId", "section");

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageItem" ADD CONSTRAINT "DamageItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DamageReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL, not CASCADE: deleting a case must never destroy the photographic
-- evidence of the damage it was opened for.
ALTER TABLE "DamageItem" ADD CONSTRAINT "DamageItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "IssueTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DamageItemPhoto" ADD CONSTRAINT "DamageItemPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DamageItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
