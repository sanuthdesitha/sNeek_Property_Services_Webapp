-- CreateEnum
CREATE TYPE "QaReworkSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- CreateEnum
CREATE TYPE "QaReworkTransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "gpsCheckInAccuracyM" DOUBLE PRECISION,
ADD COLUMN     "gpsCheckInAdjusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gpsCheckInConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gpsCheckInNote" TEXT;

-- AlterTable
ALTER TABLE "QaAssignment" ADD COLUMN     "onSiteEndedAt" TIMESTAMP(3),
ADD COLUMN     "onSiteMinutes" INTEGER,
ADD COLUMN     "onSiteStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaReworkTransfer" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "qaUserId" TEXT NOT NULL,
    "cleanerUserId" TEXT NOT NULL,
    "severity" "QaReworkSeverity" NOT NULL DEFAULT 'MINOR',
    "reason" TEXT NOT NULL,
    "areas" JSONB,
    "minutesFromCleaner" INTEGER NOT NULL DEFAULT 0,
    "amountFromCleaner" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "affectsCleanerStats" BOOLEAN NOT NULL DEFAULT true,
    "status" "QaReworkTransferStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaReworkTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE INDEX "QaReworkTransfer_jobId_status_idx" ON "QaReworkTransfer"("jobId", "status");

-- CreateIndex
CREATE INDEX "QaReworkTransfer_cleanerUserId_status_idx" ON "QaReworkTransfer"("cleanerUserId", "status");

-- CreateIndex
CREATE INDEX "QaReworkTransfer_qaUserId_status_idx" ON "QaReworkTransfer"("qaUserId", "status");

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReworkTransfer" ADD CONSTRAINT "QaReworkTransfer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReworkTransfer" ADD CONSTRAINT "QaReworkTransfer_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "QaAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReworkTransfer" ADD CONSTRAINT "QaReworkTransfer_qaUserId_fkey" FOREIGN KEY ("qaUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReworkTransfer" ADD CONSTRAINT "QaReworkTransfer_cleanerUserId_fkey" FOREIGN KEY ("cleanerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReworkTransfer" ADD CONSTRAINT "QaReworkTransfer_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
