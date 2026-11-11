-- Separate the office's private note about a person from that person's own
-- "notes to admin". Both used User.notes, so a staff member could read and
-- edit what the office wrote about them.
--
-- Nothing is removed or rewritten. User.notes keeps every existing value and
-- remains the person's own note. The office gets a private copy of what was
-- there, because an existing value may have been written by either side and
-- the office must not lose its history.
BEGIN;

ALTER TABLE "User" ADD COLUMN "adminNotes" TEXT;

UPDATE "User"
SET "adminNotes" = "notes"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';

COMMIT;
