-- CreateEnum
CREATE TYPE "JobTaskSource" AS ENUM ('ADMIN', 'CLIENT', 'CARRY_FORWARD');

-- CreateEnum
CREATE TYPE "JobTaskApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'AUTO_APPROVED');

-- CreateEnum
CREATE TYPE "JobTaskExecutionStatus" AS ENUM ('OPEN', 'COMPLETED', 'NOT_COMPLETED', 'CARRIED_FORWARD', 'CANCELLED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN "portalVisibilityOverrides" JSONB;

-- CreateTable
CREATE TABLE "JobTask" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "propertyId" TEXT NOT NULL,
    "clientId" TEXT,
    "source" "JobTaskSource" NOT NULL,
    "approvalStatus" "JobTaskApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "executionStatus" "JobTaskExecutionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "visibleToCleaner" BOOLEAN NOT NULL DEFAULT false,
    "requestedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "parentTaskId" TEXT,
    "autoApproveAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "mediaType" "MediaType" NOT NULL DEFAULT 'PHOTO',
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTaskEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobTaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobTask_jobId_approvalStatus_executionStatus_idx" ON "JobTask"("jobId", "approvalStatus", "executionStatus");

-- CreateIndex
CREATE INDEX "JobTask_propertyId_approvalStatus_executionStatus_idx" ON "JobTask"("propertyId", "approvalStatus", "executionStatus");

-- CreateIndex
CREATE INDEX "JobTask_clientId_approvalStatus_executionStatus_idx" ON "JobTask"("clientId", "approvalStatus", "executionStatus");

-- CreateIndex
CREATE INDEX "JobTask_autoApproveAt_approvalStatus_idx" ON "JobTask"("autoApproveAt", "approvalStatus");

-- CreateIndex
CREATE INDEX "JobTaskAttachment_taskId_kind_idx" ON "JobTaskAttachment"("taskId", "kind");

-- CreateIndex
CREATE INDEX "JobTaskEvent_taskId_createdAt_idx" ON "JobTaskEvent"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTask" ADD CONSTRAINT "JobTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "JobTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTaskAttachment" ADD CONSTRAINT "JobTaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "JobTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTaskAttachment" ADD CONSTRAINT "JobTaskAttachment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTaskEvent" ADD CONSTRAINT "JobTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "JobTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTaskEvent" ADD CONSTRAINT "JobTaskEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
