-- ACCESS-3 audit: Property.propertyType and Property.sizeSqm were written on
-- onboarding approval and read by nothing. Both remain on
-- PropertyOnboardingSurvey, where the intake UI and the cleaner-count estimator
-- (lib/onboarding/estimation/calculator.ts) actually use them.
--
-- IRREVERSIBLE. Confirm both columns are empty on the target database first:
--   SELECT count(*) FROM "Property"
--    WHERE "propertyType" IS NOT NULL OR "sizeSqm" IS NOT NULL;
--
-- This touches ONLY the Property table. The identically-named
-- PropertyOnboardingSurvey columns are deliberately left in place.
ALTER TABLE "Property" DROP COLUMN "propertyType";
ALTER TABLE "Property" DROP COLUMN "sizeSqm";
