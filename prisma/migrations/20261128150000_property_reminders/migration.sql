-- Smart property reminders, slice A (2026-11-28): reminders the office writes
-- for cleaners at one property (optionally one cleaner), the jobs each was
-- used on (counts "next N jobs") and per-job confirmations.
-- Additive: two new enums and three new tables. No existing table or row changes.

-- CreateEnum
CREATE TYPE "PropertyReminderMoment" AS ENUM ('BEFORE_START', 'ROOM', 'BEFORE_LEAVING');

-- CreateEnum
CREATE TYPE "PropertyReminderLifetime" AS ENUM ('EVERY_JOB', 'NEXT_JOBS', 'UNTIL_DATE');

-- CreateTable
CREATE TABLE "PropertyReminder" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "cleanerId" TEXT,
    "text" TEXT NOT NULL,
    "moment" "PropertyReminderMoment" NOT NULL,
    "roomKey" TEXT,
    "lifetime" "PropertyReminderLifetime" NOT NULL DEFAULT 'EVERY_JOB',
    "jobsCount" INTEGER,
    "untilDate" DATE,
    "mustConfirm" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'OFFICE',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyReminderClaim" (
    "id" TEXT NOT NULL,
    "reminderKey" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyReminderClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyReminderAck" (
    "id" TEXT NOT NULL,
    "reminderKey" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "moment" "PropertyReminderMoment" NOT NULL,
    "text" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyReminderAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyReminder_propertyId_endedAt_idx" ON "PropertyReminder"("propertyId", "endedAt");

-- CreateIndex
CREATE INDEX "PropertyReminderClaim_jobId_idx" ON "PropertyReminderClaim"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyReminderClaim_reminderKey_jobId_key" ON "PropertyReminderClaim"("reminderKey", "jobId");

-- CreateIndex
CREATE INDEX "PropertyReminderAck_jobId_idx" ON "PropertyReminderAck"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyReminderAck_reminderKey_jobId_userId_key" ON "PropertyReminderAck"("reminderKey", "jobId", "userId");

-- AddForeignKey
ALTER TABLE "PropertyReminder" ADD CONSTRAINT "PropertyReminder_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

