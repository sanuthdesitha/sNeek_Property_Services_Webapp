-- AlterEnum: Add EN_ROUTE to JobStatus
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'EN_ROUTE'
      AND enumtypid = 'JobStatus'::regtype
  ) THEN
    ALTER TYPE "JobStatus" ADD VALUE 'EN_ROUTE';
  END IF;
END $$;

-- AlterTable: Add Job drive-session and reschedule fields
ALTER TABLE "Job" ADD COLUMN "manuallyRescheduledAt" TIMESTAMP(3),
ADD COLUMN "rescheduledBy" TEXT,
ADD COLUMN "enRouteStartedAt" TIMESTAMP(3),
ADD COLUMN "enRouteEtaMinutes" INTEGER,
ADD COLUMN "enRouteEtaUpdatedAt" TIMESTAMP(3),
ADD COLUMN "drivingPausedAt" TIMESTAMP(3),
ADD COLUMN "drivingPauseReason" TEXT,
ADD COLUMN "drivingDelayedAt" TIMESTAMP(3),
ADD COLUMN "drivingDelayedReason" TEXT,
ADD COLUMN "arrivedAt" TIMESTAMP(3),
ADD COLUMN "lastEtaNotificationAt" TIMESTAMP(3),
ADD COLUMN "lastEtaNotifiedMinutes" INTEGER,
ADD COLUMN "lastDelayedNotificationAt" TIMESTAMP(3);

-- AlterTable: Add JobTask metadata field
ALTER TABLE "JobTask" ADD COLUMN "metadata" JSONB;

-- AlterTable: Add IssueTicket metadata field (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'IssueTicket' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE "IssueTicket" ADD COLUMN "metadata" JSONB;
  END IF;
END $$;

-- AlterTable: Add Client lastReviewRequestSentAt
ALTER TABLE "Client" ADD COLUMN "lastReviewRequestSentAt" TIMESTAMP(3);

-- AlterTable: Add Property showCleanerContactToClient
ALTER TABLE "Property" ADD COLUMN "showCleanerContactToClient" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add Notification externalId and deliveryStatus
ALTER TABLE "Notification" ADD COLUMN "externalId" TEXT,
ADD COLUMN "deliveryStatus" TEXT;

-- CreateTable: CleanerLocationPing
CREATE TABLE "CleanerLocationPing" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanerLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClientNotificationPreference
CREATE TABLE "ClientNotificationPreference" (
    "clientId" TEXT NOT NULL,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnEnRoute" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnJobStart" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnJobComplete" BOOLEAN NOT NULL DEFAULT true,
    "preferredChannel" TEXT NOT NULL DEFAULT 'EMAIL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNotificationPreference_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable: MessageTemplate
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "jobType" TEXT,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ClientAutomationRule
CREATE TABLE "ClientAutomationRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "jobType" TEXT,
    "templateId" TEXT,
    "delayMinutes" INTEGER NOT NULL DEFAULT 120,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: JobFeedback
CREATE TABLE "JobFeedback" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleanerLocationPing_jobId_timestamp_idx" ON "CleanerLocationPing"("jobId", "timestamp");

-- CreateIndex
CREATE INDEX "CleanerLocationPing_userId_timestamp_idx" ON "CleanerLocationPing"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "ClientAutomationRule_clientId_isEnabled_idx" ON "ClientAutomationRule"("clientId", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "JobFeedback_jobId_key" ON "JobFeedback"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobFeedback_token_key" ON "JobFeedback"("token");

-- AddForeignKey
ALTER TABLE "CleanerLocationPing" ADD CONSTRAINT "CleanerLocationPing_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanerLocationPing" ADD CONSTRAINT "CleanerLocationPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotificationPreference" ADD CONSTRAINT "ClientNotificationPreference_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAutomationRule" ADD CONSTRAINT "ClientAutomationRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAutomationRule" ADD CONSTRAINT "ClientAutomationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFeedback" ADD CONSTRAINT "JobFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFeedback" ADD CONSTRAINT "JobFeedback_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
