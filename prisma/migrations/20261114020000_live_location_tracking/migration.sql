-- Live location tracking (2026-11): clock-corrected pings with a server
-- receive time, source and client id; latest position per person; per-segment
-- clock-in/out location; the client's live-location switch (default off); and
-- the versioned acknowledgement of the live-location notice.

-- CreateEnum
CREATE TYPE "LocationPingSource" AS ENUM ('CLEANER_JOB', 'CLEANER_DRIVING', 'LAUNDRY_ROUTE');

-- AlterTable: existing rows keep their timestamp; receivedAt starts equal to it.
ALTER TABLE "CleanerLocationPing"
  ADD COLUMN "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "source" "LocationPingSource" NOT NULL DEFAULT 'CLEANER_JOB',
  ADD COLUMN "clientId" TEXT,
  ADD COLUMN "laundryRouteId" TEXT;

UPDATE "CleanerLocationPing" SET "receivedAt" = "timestamp";

-- Existing driver pings were stored under laundry users; label them.
UPDATE "CleanerLocationPing" p SET "source" = 'LAUNDRY_ROUTE'
  FROM "User" u WHERE u."id" = p."userId" AND u."role" = 'LAUNDRY';

-- CreateIndex
CREATE UNIQUE INDEX "CleanerLocationPing_userId_clientId_key" ON "CleanerLocationPing"("userId", "clientId");
CREATE INDEX "CleanerLocationPing_receivedAt_idx" ON "CleanerLocationPing"("receivedAt");
CREATE INDEX "CleanerLocationPing_timestamp_idx" ON "CleanerLocationPing"("timestamp");

-- CreateTable
CREATE TABLE "UserLastLocation" (
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "measuredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "source" "LocationPingSource",
    "jobId" TEXT,
    "laundryRouteId" TEXT,
    "trackingState" TEXT,
    "trackingStateAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLastLocation_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "UserLastLocation_measuredAt_idx" ON "UserLastLocation"("measuredAt");

ALTER TABLE "UserLastLocation" ADD CONSTRAINT "UserLastLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the newest retained ping per person becomes their last location.
INSERT INTO "UserLastLocation" ("userId", "lat", "lng", "accuracy", "heading", "speed", "measuredAt", "receivedAt", "source", "jobId", "updatedAt")
SELECT DISTINCT ON (p."userId") p."userId", p."lat", p."lng", p."accuracy", p."heading", p."speed", p."timestamp", p."receivedAt", p."source", p."jobId", CURRENT_TIMESTAMP
FROM "CleanerLocationPing" p
ORDER BY p."userId", p."timestamp" DESC, p."id" DESC;

-- CreateTable
CREATE TABLE "LocationTrackingNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "portal" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "LocationTrackingNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LocationTrackingNotice_userId_version_portal_key" ON "LocationTrackingNotice"("userId", "version", "portal");
CREATE INDEX "LocationTrackingNotice_userId_acknowledgedAt_idx" ON "LocationTrackingNotice"("userId", "acknowledgedAt");

ALTER TABLE "LocationTrackingNotice" ADD CONSTRAINT "LocationTrackingNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: per-segment clock locations (nullable; history is not invented).
ALTER TABLE "TimeLog"
  ADD COLUMN "startLat" DOUBLE PRECISION,
  ADD COLUMN "startLng" DOUBLE PRECISION,
  ADD COLUMN "startAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "startDistanceM" DOUBLE PRECISION,
  ADD COLUMN "startVerdict" TEXT,
  ADD COLUMN "startReasonCode" TEXT,
  ADD COLUMN "startNote" TEXT,
  ADD COLUMN "startLocationSource" TEXT,
  ADD COLUMN "stopLat" DOUBLE PRECISION,
  ADD COLUMN "stopLng" DOUBLE PRECISION,
  ADD COLUMN "stopAccuracyM" DOUBLE PRECISION,
  ADD COLUMN "stopDistanceM" DOUBLE PRECISION,
  ADD COLUMN "stopLocationAt" TIMESTAMP(3);

-- AlterTable: the client's live-location switch, off by default.
ALTER TABLE "Client" ADD COLUMN "showCleanerLiveLocation" BOOLEAN NOT NULL DEFAULT false;
