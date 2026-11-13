-- Live location follow-up (2026-11-14): a clock segment started without a
-- location fix records the first later fix as a LATE start location; this is
-- when that fix was measured. Nullable; existing rows are untouched.
ALTER TABLE "TimeLog" ADD COLUMN "startLocationAt" TIMESTAMP(3);
