-- Job-level form-template pin. Additive only — no existing column is altered
-- or dropped, and no data is rewritten.
--
-- Background: converting a quote to a job mints a one-off CUSTOM FormTemplate
-- carrying the scope the client actually agreed to, and (before this change)
-- registered it as the PROPERTY's permanent per-job-type override in
-- settings.propertyFormTemplateOverrides. That made a single quote's scope the
-- form for every future job of that type at that property, and cut those jobs
-- off from the admin's edits to the real global template.
--
-- The owner's decision is "use it for that job only", which needs somewhere to
-- record "this job renders that template" — hence Job.formTemplateId. It is the
-- highest-priority input in lib/forms/resolve-job-template.ts; jobs without a
-- pin resolve exactly as before (property override → newest active global).
--
-- ON DELETE SET NULL: deleting a template must never delete job history. The
-- job simply falls back to normal resolution.
ALTER TABLE "Job" ADD COLUMN "formTemplateId" TEXT;

CREATE INDEX "Job_formTemplateId_idx" ON "Job"("formTemplateId");

ALTER TABLE "Job"
    ADD CONSTRAINT "Job_formTemplateId_fkey"
    FOREIGN KEY ("formTemplateId") REFERENCES "FormTemplate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Marker for a template minted for ONE job. Such a row stays active (its job
-- must render it) but is excluded from the global-default fallback and from the
-- "publish archives the previous global" sweep. Property-scoped rows are known
-- from the settings override map; job-scoped rows have no entry there, so the
-- fact has to live on the row.
ALTER TABLE "FormTemplate" ADD COLUMN "isJobScoped" BOOLEAN NOT NULL DEFAULT false;
