-- Accountability P1: evidence configuration + property quality config + rotation state

DO $$ BEGIN
  CREATE TYPE "EvidenceFrequency" AS ENUM ('EVERY_CLEAN','CONDITIONAL','ROTATIONAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "ChecklistModuleItem" ADD COLUMN IF NOT EXISTS "evidenceCategory" TEXT;
ALTER TABLE "ChecklistModuleItem" ADD COLUMN IF NOT EXISTS "frequency" "EvidenceFrequency" NOT NULL DEFAULT 'EVERY_CLEAN';
ALTER TABLE "ChecklistModuleItem" ADD COLUMN IF NOT EXISTS "conditionKey" TEXT;
ALTER TABLE "ChecklistModuleItem" ADD COLUMN IF NOT EXISTS "rotationEveryNCleans" INTEGER;
ALTER TABLE "ChecklistModuleItem" ADD COLUMN IF NOT EXISTS "maxPhotos" INTEGER;
ALTER TABLE "ChecklistModuleItem" ADD COLUMN IF NOT EXISTS "severity" TEXT;

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "cleaningDurationMinutes" INTEGER;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "cleanerServiceRate" DOUBLE PRECISION;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "laundryBagLabel" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "laundryBagColor" TEXT;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "sofaBedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "setupGuide" JSONB;

CREATE TABLE IF NOT EXISTS "PropertyRotationState" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "lastCompletedAt" TIMESTAMP(3),
  "lastCompletedJobId" TEXT,
  "cleansSinceDone" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PropertyRotationState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PropertyRotationState_propertyId_itemKey_key" ON "PropertyRotationState"("propertyId","itemKey");
CREATE INDEX IF NOT EXISTS "PropertyRotationState_propertyId_idx" ON "PropertyRotationState"("propertyId");
DO $$ BEGIN
  ALTER TABLE "PropertyRotationState" ADD CONSTRAINT "PropertyRotationState_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "PropertyRotationState" ADD CONSTRAINT "PropertyRotationState_lastCompletedJobId_fkey" FOREIGN KEY ("lastCompletedJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
