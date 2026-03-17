-- CreateEnum
CREATE TYPE "PayAdjustmentType" AS ENUM ('HOURLY', 'FIXED');

-- CreateEnum
CREATE TYPE "PayAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CleanerPayAdjustment" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "cleanerId" TEXT NOT NULL,
    "type" "PayAdjustmentType" NOT NULL,
    "requestedHours" DOUBLE PRECISION,
    "requestedRate" DOUBLE PRECISION,
    "requestedAmount" DOUBLE PRECISION NOT NULL,
    "approvedAmount" DOUBLE PRECISION,
    "status" "PayAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "cleanerNote" TEXT,
    "adminNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleanerPayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleanerPayAdjustment_cleanerId_status_idx" ON "CleanerPayAdjustment"("cleanerId", "status");

-- CreateIndex
CREATE INDEX "CleanerPayAdjustment_jobId_status_idx" ON "CleanerPayAdjustment"("jobId", "status");

-- AddForeignKey
ALTER TABLE "CleanerPayAdjustment" ADD CONSTRAINT "CleanerPayAdjustment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanerPayAdjustment" ADD CONSTRAINT "CleanerPayAdjustment_cleanerId_fkey" FOREIGN KEY ("cleanerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanerPayAdjustment" ADD CONSTRAINT "CleanerPayAdjustment_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
