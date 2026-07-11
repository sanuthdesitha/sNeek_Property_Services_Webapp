-- Property: rich image-backed access guide
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "accessGuide" JSONB;

-- Lost & Found tracking
DO $$ BEGIN
  CREATE TYPE "LostFoundStatus" AS ENUM ('REPORTED','IN_STORAGE','GUEST_CONTACTED','RETURN_OFFERED','RETURNED','DISPOSED','DONATED','UNCLAIMED','ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "LostFoundItem" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT,
  "jobId" TEXT,
  "reportedByUserId" TEXT,
  "itemName" TEXT NOT NULL,
  "description" TEXT,
  "foundLocation" TEXT,
  "photos" JSONB,
  "status" "LostFoundStatus" NOT NULL DEFAULT 'REPORTED',
  "guestName" TEXT,
  "guestContact" TEXT,
  "estimatedValue" DOUBLE PRECISION,
  "resolution" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LostFoundItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LostFoundItem_propertyId_idx" ON "LostFoundItem"("propertyId");
CREATE INDEX IF NOT EXISTS "LostFoundItem_jobId_idx" ON "LostFoundItem"("jobId");
CREATE INDEX IF NOT EXISTS "LostFoundItem_status_idx" ON "LostFoundItem"("status");
CREATE INDEX IF NOT EXISTS "LostFoundItem_createdAt_idx" ON "LostFoundItem"("createdAt");

CREATE TABLE IF NOT EXISTS "LostFoundEvent" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LostFoundEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LostFoundEvent_itemId_idx" ON "LostFoundEvent"("itemId");
DO $$ BEGIN
  ALTER TABLE "LostFoundEvent" ADD CONSTRAINT "LostFoundEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LostFoundItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
