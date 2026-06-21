-- Maintenance portal: MAINTENANCE role, maintenance workers, assignment +
-- visit lifecycle on maintenance items, and GPS pings. Additive only.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MAINTENANCE';

CREATE TYPE "MaintenanceOutcome" AS ENUM ('FIXED', 'REPLACED', 'NEEDS_PARTS', 'NEEDS_FOLLOWUP', 'NO_ACCESS', 'NO_ISSUE_FOUND', 'OTHER');
CREATE TYPE "MaintenancePingKind" AS ENUM ('PING', 'ARRIVED', 'CLOCK_IN', 'CLOCK_OUT');

-- Maintenance workers (ad-hoc or permanent portal user)
CREATE TABLE "MaintenanceWorker" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "trade" TEXT,
  "company" TEXT,
  "isPermanent" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "userId" TEXT,
  "createdById" TEXT,
  "onboardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MaintenanceWorker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaintenanceWorker_userId_key" ON "MaintenanceWorker" ("userId");
CREATE INDEX "MaintenanceWorker_isActive_isPermanent_idx" ON "MaintenanceWorker" ("isActive", "isPermanent");

-- Assignment + visit-lifecycle columns on the maintenance item
ALTER TABLE "PropertyMaintenanceItem"
  ADD COLUMN "assignedWorkerId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "assignedByUserId" TEXT,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "shareAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contactPersonUserId" TEXT,
  ADD COLUMN "enRouteAt" TIMESTAMP(3),
  ADD COLUMN "arrivedAt" TIMESTAMP(3),
  ADD COLUMN "workStartedAt" TIMESTAMP(3),
  ADD COLUMN "clockInAt" TIMESTAMP(3),
  ADD COLUMN "clockOutAt" TIMESTAMP(3),
  ADD COLUMN "outcome" "MaintenanceOutcome",
  ADD COLUMN "workerNote" TEXT,
  ADD COLUMN "issuesNote" TEXT,
  ADD COLUMN "finishPhotoKeys" JSONB;

CREATE INDEX "PropertyMaintenanceItem_assignedWorkerId_status_idx" ON "PropertyMaintenanceItem" ("assignedWorkerId", "status");

-- GPS pings for a maintenance visit
CREATE TABLE "MaintenanceLocationPing" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "workerId" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION,
  "kind" "MaintenancePingKind" NOT NULL DEFAULT 'PING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaintenanceLocationPing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceLocationPing_itemId_createdAt_idx" ON "MaintenanceLocationPing" ("itemId", "createdAt");

-- Foreign keys
ALTER TABLE "MaintenanceWorker"
  ADD CONSTRAINT "MaintenanceWorker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "MaintenanceWorker_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PropertyMaintenanceItem"
  ADD CONSTRAINT "PropertyMaintenanceItem_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "MaintenanceWorker" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PropertyMaintenanceItem_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PropertyMaintenanceItem_contactPersonUserId_fkey" FOREIGN KEY ("contactPersonUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MaintenanceLocationPing"
  ADD CONSTRAINT "MaintenanceLocationPing_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PropertyMaintenanceItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MaintenanceLocationPing_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "MaintenanceWorker" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
