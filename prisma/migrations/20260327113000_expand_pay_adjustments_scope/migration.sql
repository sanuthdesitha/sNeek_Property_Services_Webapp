DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PayAdjustmentScope') THEN
    CREATE TYPE "PayAdjustmentScope" AS ENUM ('JOB', 'PROPERTY', 'STANDALONE');
  END IF;
END $$;

ALTER TABLE "CleanerPayAdjustment"
  ALTER COLUMN "jobId" DROP NOT NULL;

ALTER TABLE "CleanerPayAdjustment"
  ADD COLUMN IF NOT EXISTS "propertyId" TEXT,
  ADD COLUMN IF NOT EXISTS "scope" "PayAdjustmentScope" NOT NULL DEFAULT 'JOB',
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "attachmentKeys" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'CleanerPayAdjustment_propertyId_fkey'
      AND table_name = 'CleanerPayAdjustment'
  ) THEN
    ALTER TABLE "CleanerPayAdjustment"
      ADD CONSTRAINT "CleanerPayAdjustment_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CleanerPayAdjustment_propertyId_status_idx"
  ON "CleanerPayAdjustment"("propertyId", "status");
