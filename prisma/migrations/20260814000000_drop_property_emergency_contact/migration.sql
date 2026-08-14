-- ACCESS-3 audit: Property.emergencyContact was written on onboarding approval
-- and read by nothing. The survey's copy still reaches the onboarding job's
-- internalNotes, so the intake data survives this drop.
--
-- IRREVERSIBLE. Confirm the column is empty on the target database first:
--   SELECT count(*) FROM "Property" WHERE "emergencyContact" IS NOT NULL;
--
-- NOTE: Property.recurringSchedule was audited at the same time and deliberately
-- KEPT — lib/marketing/segments.ts reads it, and quote->job conversion writes it.
ALTER TABLE "Property" DROP COLUMN "emergencyContact";
