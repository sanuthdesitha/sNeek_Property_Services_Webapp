-- "Looks unused — ask the office" (2026-11-28): one row per question a cleaner
-- asks before cleaning a turnover that looks unused, with the office answer.
-- Additive: a new enum and a new table. No existing table or row changes.

-- CreateEnum
CREATE TYPE "JobUnusedCheckDecision" AS ENUM ('CLEAN_AS_NORMAL', 'LIGHT_REFRESH', 'DO_NOT_CLEAN');

-- CreateTable
CREATE TABLE "JobUnusedCheck" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "openForJobId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "note" TEXT,
    "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision" "JobUnusedCheckDecision",
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedByRole" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobUnusedCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobUnusedCheck_openForJobId_key" ON "JobUnusedCheck"("openForJobId");

-- CreateIndex
CREATE INDEX "JobUnusedCheck_jobId_createdAt_idx" ON "JobUnusedCheck"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobUnusedCheck_decidedAt_createdAt_idx" ON "JobUnusedCheck"("decidedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobUnusedCheck_requestedById_requestKey_key" ON "JobUnusedCheck"("requestedById", "requestKey");

-- AddForeignKey
ALTER TABLE "JobUnusedCheck" ADD CONSTRAINT "JobUnusedCheck_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

