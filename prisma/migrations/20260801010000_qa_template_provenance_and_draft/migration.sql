-- QA template provenance + server-side inspection drafts.
--
-- isSystemManaged: the auto-upgrade in resolveTemplate used to decide what it
-- was allowed to rewrite by matching the template NAME ("Default QA - …"). An
-- admin who edited the default template in place, without renaming it, had
-- their edits silently overwritten the next time anyone opened a job. Existing
-- rows default to FALSE — the safe direction, since a template we don't
-- positively know to be system-owned must never be rewritten.
--
-- sourceFormTemplateId: which cleaner checklist a QA template was generated
-- from, so it can be regenerated and drift can be detected.
--
-- draft: server-side autosave for an in-progress inspection. Previously the
-- only persistence was localStorage, so an unfinished inspection was tied to
-- one browser profile.
ALTER TABLE "QaFormTemplate"
  ADD COLUMN IF NOT EXISTS "isSystemManaged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceFormTemplateId" TEXT;

ALTER TABLE "QaAssignment"
  ADD COLUMN IF NOT EXISTS "draft" JSONB;

-- Backfill: the templates the system genuinely does own are the generated
-- defaults, identified by the same name prefix the old code keyed on. Doing it
-- ONCE here (rather than continuing to match on names at runtime) is what stops
-- an admin's edits being clobbered from now on.
UPDATE "QaFormTemplate"
SET "isSystemManaged" = true
WHERE "name" LIKE 'Default QA -%';
