-- Foundation A: design system + cross-cutting infra phase
-- Adds: geocode fields on User/Client + placeId on Property
--       UiDensity + EmailStatus enums; User.uiDensity/emailStatus/lastSeenAt
--       UploadFailure model with FKs and indexes

-- CreateEnum
CREATE TYPE "UiDensity" AS ENUM ('COMPACT', 'DEFAULT', 'COMFORTABLE');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('OK', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'COMPLAINT', 'UNSUBSCRIBED');

-- AlterTable: User — geocode + density + email + lastSeen
ALTER TABLE "User"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "placeId" TEXT,
  ADD COLUMN "suburb" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postcode" TEXT,
  ADD COLUMN "uiDensity" "UiDensity" NOT NULL DEFAULT 'DEFAULT',
  ADD COLUMN "emailStatus" "EmailStatus" NOT NULL DEFAULT 'OK',
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- AlterTable: Client — geocode
ALTER TABLE "Client"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "placeId" TEXT,
  ADD COLUMN "suburb" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postcode" TEXT;

-- AlterTable: Property — placeId only (lat/lng/suburb/state/postcode already exist)
ALTER TABLE "Property" ADD COLUMN "placeId" TEXT;

-- CreateTable: UploadFailure
CREATE TABLE "UploadFailure" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "jobId" TEXT,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "message" TEXT,
    "stack" TEXT,
    "context" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "UploadFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: User
CREATE INDEX "User_emailStatus_idx" ON "User"("emailStatus");
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex: Property
CREATE INDEX "Property_placeId_idx" ON "Property"("placeId");
CREATE INDEX "Property_suburb_idx" ON "Property"("suburb");

-- CreateIndex: UploadFailure
CREATE INDEX "UploadFailure_occurredAt_idx" ON "UploadFailure"("occurredAt");
CREATE INDEX "UploadFailure_userId_occurredAt_idx" ON "UploadFailure"("userId", "occurredAt");
CREATE INDEX "UploadFailure_jobId_idx" ON "UploadFailure"("jobId");
CREATE INDEX "UploadFailure_resolvedAt_idx" ON "UploadFailure"("resolvedAt");

-- AddForeignKey: UploadFailure → User
ALTER TABLE "UploadFailure" ADD CONSTRAINT "UploadFailure_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: UploadFailure → Job
ALTER TABLE "UploadFailure" ADD CONSTRAINT "UploadFailure_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
