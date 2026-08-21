-- Enforce tag-only clock-in, per property.
--
-- DEFAULT false, and per property rather than a global setting, because the
-- rule only makes sense where a tag is physically on the wall. Switching it on
-- globally — or defaulting it true — would lock every cleaner out of every
-- property that has no tag yet, which is all of them on the day this ships.
--
-- Read by the cleaner start route: with this on, a job at this property cannot
-- be started unless the cleaner has an accepted NFC scan against it.

ALTER TABLE "Property" ADD COLUMN "requireNfcCheckIn" BOOLEAN NOT NULL DEFAULT false;
