-- On-site check-in gate.
--
-- Until now GPS distance was COMPUTED AND STORED AT CHECK-IN AND NEVER ACTED ON:
-- a check-in 40 km from the property returned 200 OK with a friendly
-- "Check-in recorded 40219m from the property." These columns capture the
-- coded reason when someone starts away from the property, so off-site starts
-- can be counted and compared rather than read one at a time.
--
-- geofenceRadiusM lets a large complex or an underground carpark carry more
-- slack than a street-front terrace; null means the default.
ALTER TABLE "Job"
  ADD COLUMN IF NOT EXISTS "gpsCheckInReasonCode" TEXT;

ALTER TABLE "QaAssignment"
  ADD COLUMN IF NOT EXISTS "checkInReasonCode" TEXT;

ALTER TABLE "Property"
  ADD COLUMN IF NOT EXISTS "geofenceRadiusM" INTEGER;
