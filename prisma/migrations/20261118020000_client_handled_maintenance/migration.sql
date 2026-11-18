-- Client-handled maintenance (2026-11-18): the office can hand a maintenance
-- item to the client to arrange with their own tradesperson. Additive only:
-- one enum, nullable columns and defaults, one index. Existing rows read as
-- NONE (ours, as before); no data is changed or removed.

-- CreateEnum
CREATE TYPE "MaintenanceClientHandling" AS ENUM ('NONE', 'HANDED_OVER', 'ACCEPTED', 'DECLINED', 'DONE', 'NOT_DONE', 'TAKEN_BACK');

-- AlterTable
ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN     "clientDeclineReason" TEXT,
ADD COLUMN     "clientHandedOverAt" TIMESTAMP(3),
ADD COLUMN     "clientHandedOverById" TEXT,
ADD COLUMN     "clientHandling" "MaintenanceClientHandling" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "clientHandlingVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clientHandoverNote" TEXT,
ADD COLUMN     "clientHandoverNotice" JSONB,
ADD COLUMN     "clientLastReminderAt" TIMESTAMP(3),
ADD COLUMN     "clientLastReminderById" TEXT,
ADD COLUMN     "clientLastReminderKey" TEXT,
ADD COLUMN     "clientLastReminderOutcome" JSONB,
ADD COLUMN     "clientOutcomeAt" TIMESTAMP(3),
ADD COLUMN     "clientOutcomeById" TEXT,
ADD COLUMN     "clientOutcomeNote" TEXT,
ADD COLUMN     "clientOutcomePhotoKeys" JSONB,
ADD COLUMN     "clientReminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clientRespondedAt" TIMESTAMP(3),
ADD COLUMN     "clientRespondedById" TEXT,
ADD COLUMN     "clientTakenBackAt" TIMESTAMP(3),
ADD COLUMN     "clientTakenBackById" TEXT,
ADD COLUMN     "clientTakenBackReason" TEXT,
ADD COLUMN     "clientTradesperson" JSONB,
ADD COLUMN     "clientTradespersonAt" TIMESTAMP(3),
ADD COLUMN     "clientTradespersonById" TEXT;

-- CreateIndex
CREATE INDEX "PropertyMaintenanceItem_clientHandling_status_idx" ON "PropertyMaintenanceItem"("clientHandling", "status");

