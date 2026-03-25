-- CreateEnum
CREATE TYPE "TimeAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TimeLogAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "timeLogId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "requestedDurationM" INTEGER NOT NULL,
    "requestedStoppedAt" TIMESTAMP(3),
    "originalDurationM" INTEGER NOT NULL,
    "originalStoppedAt" TIMESTAMP(3),
    "reason" TEXT,
    "status" "TimeAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeLogAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeLogAdjustmentRequest_status_createdAt_idx" ON "TimeLogAdjustmentRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TimeLogAdjustmentRequest_jobId_status_idx" ON "TimeLogAdjustmentRequest"("jobId", "status");

-- CreateIndex
CREATE INDEX "TimeLogAdjustmentRequest_cleanerId_status_idx" ON "TimeLogAdjustmentRequest"("cleanerId", "status");

-- AddForeignKey
ALTER TABLE "TimeLogAdjustmentRequest" ADD CONSTRAINT "TimeLogAdjustmentRequest_timeLogId_fkey" FOREIGN KEY ("timeLogId") REFERENCES "TimeLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLogAdjustmentRequest" ADD CONSTRAINT "TimeLogAdjustmentRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLogAdjustmentRequest" ADD CONSTRAINT "TimeLogAdjustmentRequest_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLogAdjustmentRequest" ADD CONSTRAINT "TimeLogAdjustmentRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
