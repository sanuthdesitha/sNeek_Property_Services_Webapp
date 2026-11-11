"use client";

/**
 * Publish: blocked while a check ERROR exists (the server refuses it too, in
 * the single publish path — lib/forms/template-publish.ts assertPublishable),
 * shows where the form applies (TemplateImpactPanel) and what happens to jobs
 * in flight, and takes an optional version note.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import type { TemplateCheckResult } from "@/lib/forms/template-checks";
import { TemplateImpactPanel } from "./template-impact";

/** What really happens to jobs when a new version goes live (see resolve-effective-job-form + the submit route's revision check). */
export const IN_FLIGHT_RULE =
  "Jobs not yet submitted get this version the next time the cleaner's form loads. A cleaner who already has the form open is asked to reload before submitting — their answers and photos are kept. Submitted jobs keep the version they were filled in on.";

export function PublishDialog({
  open,
  onClose,
  templateId,
  version,
  checks,
  busy,
  error,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  version: number;
  checks: TemplateCheckResult;
  busy: boolean;
  error: string | null;
  onPublish: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  React.useEffect(() => {
    if (open) setNote("");
  }, [open]);
  const errors = checks.issues.filter((issue) => issue.severity === "error");
  const blocked = errors.length > 0;
  return (
    <EModal open={open} onClose={onClose} title={`Publish v${version}`} eyebrow="Make the draft live" wide>
      <fieldset disabled={busy} className="space-y-4">
        {blocked ? (
          <div role="alert" className="rounded-[8px] border-l-[3px] border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2">
            <p className="text-[0.8125rem] font-[600]">Fix {errors.length} problem{errors.length === 1 ? "" : "s"} before publishing</p>
            <ul className="mt-1 space-y-0.5 text-[0.75rem]">
              {errors.slice(0, 8).map((issue, index) => (
                <li key={`${issue.rule}-${issue.fieldId ?? index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <TemplateImpactPanel templateId={templateId} />
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{IN_FLIGHT_RULE}</p>
        <EField label="Version note (optional)" hint="Shown in Versions, e.g. what changed and why.">
          <ETextarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </EField>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton variant="outline" size="sm" type="button" onClick={onClose}>Cancel</EButton>
          <EButton size="sm" type="button" disabled={blocked} onClick={() => onPublish(note.trim())}>
            {busy ? "Publishing…" : `Publish v${version}`}
          </EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
