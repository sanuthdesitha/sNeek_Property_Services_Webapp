-- Decimal "assigned cleaning hours" as a first-class property field (jobs prefill
-- estimatedHours from it and can override per job).
ALTER TABLE "Property" ADD COLUMN "assignedCleaningHours" DOUBLE PRECISION;

-- Backfill from the existing hours-in-JSON default, else minutes/60. accessInfo
-- is JSONB: defaultCleanDurationHours is a number when present.
UPDATE "Property"
SET "assignedCleaningHours" = CASE
  WHEN ("accessInfo" -> 'defaultCleanDurationHours') IS NOT NULL
       AND jsonb_typeof("accessInfo" -> 'defaultCleanDurationHours') = 'number'
    THEN ("accessInfo" ->> 'defaultCleanDurationHours')::double precision
  WHEN "cleaningDurationMinutes" IS NOT NULL
    THEN "cleaningDurationMinutes"::double precision / 60.0
  ELSE NULL
END
WHERE "assignedCleaningHours" IS NULL;

-- Manual "update from standard" version stamp for per-property checklist re-sync.
ALTER TABLE "PropertyChecklistProfile" ADD COLUMN "syncedLibraryVersion" TEXT;
