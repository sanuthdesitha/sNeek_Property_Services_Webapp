-- DropForeignKey
ALTER TABLE "CleanerPayAdjustment" DROP CONSTRAINT "CleanerPayAdjustment_jobId_fkey";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DiscountCampaign" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "HiringApplication" ADD COLUMN     "hiredUserId" TEXT;

-- AlterTable
ALTER TABLE "LearningPath" ADD COLUMN     "mandatory" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StaffDocument" ADD COLUMN     "requiresSignature" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "WorkforcePost" ADD COLUMN     "notificationsDispatchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChatChannelRead" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatChannelRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDocumentRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "fulfilledDocumentId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffDocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatChannelRead_channelId_userId_key" ON "ChatChannelRead"("channelId", "userId");

-- CreateIndex
CREATE INDEX "StaffDocumentRequest_userId_status_idx" ON "StaffDocumentRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "StaffDocumentRequest_requestedById_status_idx" ON "StaffDocumentRequest"("requestedById", "status");

-- AddForeignKey
ALTER TABLE "CleanerPayAdjustment" ADD CONSTRAINT "CleanerPayAdjustment_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannelRead" ADD CONSTRAINT "ChatChannelRead_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatChannelRead" ADD CONSTRAINT "ChatChannelRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocumentRequest" ADD CONSTRAINT "StaffDocumentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocumentRequest" ADD CONSTRAINT "StaffDocumentRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDocumentRequest" ADD CONSTRAINT "StaffDocumentRequest_fulfilledDocumentId_fkey" FOREIGN KEY ("fulfilledDocumentId") REFERENCES "StaffDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplication" ADD CONSTRAINT "HiringApplication_hiredUserId_fkey" FOREIGN KEY ("hiredUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
