-- CreateEnum
CREATE TYPE "HiringEventType" AS ENUM ('CREATED', 'STATUS_CHANGE', 'EMAIL_SENT', 'EMAIL_REPLY', 'NOTE', 'ASSESSMENT');

-- AlterTable
ALTER TABLE "HiringApplication"
  ADD COLUMN "emailsSent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "repliesReceived" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEmailedAt" TIMESTAMP(3),
  ADD COLUMN "lastReplyAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HiringApplicationEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "HiringEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringApplicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HiringApplicationEvent_applicationId_createdAt_idx" ON "HiringApplicationEvent"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "HiringApplicationEvent" ADD CONSTRAINT "HiringApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "HiringApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiringApplicationEvent" ADD CONSTRAINT "HiringApplicationEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
