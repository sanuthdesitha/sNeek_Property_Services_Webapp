-- Maintenance finish outcomes merged to the five drawn on the board (owner
-- decision, 2026-11-12):
--   FIXED, REPLACED  -> REPLACED_OR_REPAIRED
--   OTHER            -> NEEDS_FOLLOWUP   (an unclassified result needs the office)
--   NEEDS_PARTS, NEEDS_FOLLOWUP, NO_ACCESS, NO_ISSUE_FOUND unchanged.
-- Forward only. Step 1 keeps every recorded outcome as text BEFORE any row
-- changes; screens show "originally: Replaced" where it differs.

-- 1. Preserve the original value of every row that has an outcome.
ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN "originalOutcome" TEXT;

UPDATE "PropertyMaintenanceItem"
SET "originalOutcome" = "outcome"::text
WHERE "outcome" IS NOT NULL;

-- 2. Swap the enum, mapping each row in the same statement. "outcome" is the
--    only column of this type (checked against schema.prisma).
CREATE TYPE "MaintenanceOutcome_new" AS ENUM ('REPLACED_OR_REPAIRED', 'NEEDS_PARTS', 'NEEDS_FOLLOWUP', 'NO_ACCESS', 'NO_ISSUE_FOUND');

ALTER TABLE "PropertyMaintenanceItem"
  ALTER COLUMN "outcome" TYPE "MaintenanceOutcome_new"
  USING (
    CASE "outcome"::text
      WHEN 'FIXED' THEN 'REPLACED_OR_REPAIRED'
      WHEN 'REPLACED' THEN 'REPLACED_OR_REPAIRED'
      WHEN 'OTHER' THEN 'NEEDS_FOLLOWUP'
      ELSE "outcome"::text
    END
  )::"MaintenanceOutcome_new";

ALTER TYPE "MaintenanceOutcome" RENAME TO "MaintenanceOutcome_old";
ALTER TYPE "MaintenanceOutcome_new" RENAME TO "MaintenanceOutcome";
DROP TYPE "MaintenanceOutcome_old";

-- 3. Where the value did not change, the copy adds nothing: keep only the
--    originals that differ from what is now stored.
UPDATE "PropertyMaintenanceItem"
SET "originalOutcome" = NULL
WHERE "originalOutcome" IS NOT NULL
  AND "originalOutcome" = "outcome"::text;
