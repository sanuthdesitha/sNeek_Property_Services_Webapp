-- GPS-truth wave: when GPS confirms the cleaner left the job site (sustained
-- outside-geofence run, see lib/gps/departure.ts). Cleared on re-entry.
ALTER TABLE "Job" ADD COLUMN "departedAt" TIMESTAMP(3);
