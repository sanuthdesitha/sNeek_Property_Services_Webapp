-- When a worker's right to work ends.
--
-- `User.visaStatus` already said WHAT someone holds, but nothing said WHEN it
-- lapses — so there was no date to chase, and nothing to stop somebody being
-- rostered onto work they are no longer permitted to do.
--
-- Nullable, no default, no backfill, on purpose. Most of the workforce has no
-- visa to record, and a placeholder date would be indistinguishable from a real
-- one: the reminder sweep reads "no date" as "nothing to chase", which is
-- correct, while a wrong date is a false alarm every month or — worse — a false
-- reassurance.
--
-- Joins the same sweep as vehicleRegoExpiry and driverLicenseExpiry, which have
-- existed for some time and were never checked by anything.
-- See lib/workforce/credential-expiry.ts.

ALTER TABLE "User" ADD COLUMN "visaExpiry" TIMESTAMP(3);
