-- "Camera not working — ask the office" (cleaner job flow v2, 2026-11-28): a
-- cleaner's request to submit one job without specific missing photos, and
-- the office's decision with its reason.
-- Additive: a new enum and a new table. No existing table or row changes.

-- CreateEnum
CREATE TYPE "JobEvidenceOverrideStatus" AS ENUM ('REQUESTED', 'ALLOWED', 'DECLINED');

-- CreateTable
CREATE TABLE "JobEvidenceOverride" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "openForJobId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "fieldIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fieldLabels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "JobEvidenceOverrideStatus" NOT NULL DEFAULT 'REQUESTED',
    "allowedFieldIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedByRole" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobEvidenceOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobEvidenceOverride_openForJobId_key" ON "JobEvidenceOverride"("openForJobId");

-- CreateIndex
CREATE INDEX "JobEvidenceOverride_jobId_createdAt_idx" ON "JobEvidenceOverride"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobEvidenceOverride_status_createdAt_idx" ON "JobEvidenceOverride"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobEvidenceOverride_requestedById_requestKey_key" ON "JobEvidenceOverride"("requestedById", "requestKey");

-- AddForeignKey
ALTER TABLE "JobEvidenceOverride" ADD CONSTRAINT "JobEvidenceOverride_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
