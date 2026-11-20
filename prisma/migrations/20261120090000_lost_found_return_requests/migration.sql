-- Lost and found: guest links and return requests (2026-11-20). Additive only:
-- two new tables and three enums; no existing row or index is changed.

-- CreateEnum
CREATE TYPE "LostFoundReturnMethod" AS ENUM ('POST', 'PICKUP_AT_CLEAN', 'PICKUP_OTHER_TIME', 'DROP_OFF', 'OTHER');

-- CreateEnum
CREATE TYPE "LostFoundReturnStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'SUPERSEDED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LostFoundReturnFee" AS ENUM ('NOT_SET', 'NO_FEE', 'QUOTED');

-- CreateTable
CREATE TABLE "LostFoundGuestLink" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tokenSalt" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),

    CONSTRAINT "LostFoundGuestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LostFoundReturnRequest" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "linkId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "method" "LostFoundReturnMethod" NOT NULL,
    "status" "LostFoundReturnStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "address" JSONB,
    "requestedJobId" TEXT,
    "requestedDate" TEXT,
    "proposedTime" TEXT,
    "otherDetails" TEXT,
    "guestNote" TEXT,
    "supersedesId" TEXT,
    "clientReview" TEXT,
    "clientReviewNote" TEXT,
    "clientReviewedById" TEXT,
    "clientReviewedAt" TIMESTAMP(3),
    "decisionKey" TEXT,
    "decidedById" TEXT,
    "decidedByRole" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "confirmedMethod" "LostFoundReturnMethod",
    "confirmedJobId" TEXT,
    "confirmedDate" TEXT,
    "confirmedTime" TEXT,
    "feeState" "LostFoundReturnFee" NOT NULL DEFAULT 'NOT_SET',
    "feeCents" INTEGER,
    "feeNote" TEXT,
    "shareContactWithCleaner" BOOLEAN NOT NULL DEFAULT false,
    "jobTaskId" TEXT,
    "taskCleanerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "guestMessage" JSONB,
    "attentionReason" TEXT,
    "attentionAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completionNote" TEXT,
    "trackingReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LostFoundReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LostFoundGuestLink_tokenHash_key" ON "LostFoundGuestLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LostFoundGuestLink_itemId_createdAt_idx" ON "LostFoundGuestLink"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LostFoundReturnRequest_supersedesId_key" ON "LostFoundReturnRequest"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "LostFoundReturnRequest_jobTaskId_key" ON "LostFoundReturnRequest"("jobTaskId");

-- CreateIndex
CREATE INDEX "LostFoundReturnRequest_itemId_status_idx" ON "LostFoundReturnRequest"("itemId", "status");

-- CreateIndex
CREATE INDEX "LostFoundReturnRequest_status_createdAt_idx" ON "LostFoundReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LostFoundReturnRequest_confirmedJobId_idx" ON "LostFoundReturnRequest"("confirmedJobId");

-- CreateIndex
CREATE UNIQUE INDEX "LostFoundReturnRequest_itemId_submissionKey_key" ON "LostFoundReturnRequest"("itemId", "submissionKey");

-- AddForeignKey
ALTER TABLE "LostFoundGuestLink" ADD CONSTRAINT "LostFoundGuestLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundReturnRequest" ADD CONSTRAINT "LostFoundReturnRequest_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundReturnRequest" ADD CONSTRAINT "LostFoundReturnRequest_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LostFoundGuestLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LostFoundReturnRequest" ADD CONSTRAINT "LostFoundReturnRequest_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "LostFoundReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

