"use client";

/**
 * "Copy to other forms": copy the selected questions into other forms as
 * DRAFTS through the forms library's bulk service (operation
 * "insert-questions"). First a preview (dry run) per form, then apply.
 * New ids are generated per form; a show/hide rule that watches a question
 * outside the copied set is dropped, and that is shown before anything is
 * saved. Nothing reaches cleaners until each form is published.
 */
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EInput, EModal } from "@/components/v2/admin/estate-kit";
import { copyFieldsWithNewIds } from "@/lib/forms/builder-ops";
import type { BulkFormOutcome, BulkResponse } from "@/lib/forms/template-bulk-types";
import { BULK_MAX_FORMS } from "@/lib/forms/template-bulk-types";
import type { FormField } from "@/lib/forms/types";

type FormOption = { id: string; name: string; serviceType: string; version: number; isActive: boolean; archivedAt: string | null };
type Step = { kind: "choose" } | { kind: "preview"; response: BulkResponse } | { kind: "done"; response: BulkResponse };

function OutcomeRows({ outcomes }: { outcomes: BulkFormOutcome[] }) {
  return (
    <ul className="space-y-1.5">
      {outcomes.map((outcome) => (
        <li key={outcome.templateId} className="rounded-[8px] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-[600]">{outcome.name}</span>
            <EPill tone={outcome.status === "refused" ? "bad" : outcome.status === "unchanged" ? "neutral" : "ok"}>
              {outcome.status === "would-change" ? "Will get a draft" : outcome.status === "changed" ? "Draft saved" : outcome.status === "refused" ? "Not copied" : "Unchanged"}
            </EPill>
          </div>
          {outcome.reason ? <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{outcome.reason}</p> : null}
          {outcome.changes.filter((change) => change.property === "rule dropped").map((change) => (
            <p key={`${change.fieldLabel}-drop`} className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-warning))]">
              “{change.fieldLabel}” loses its show/hide rule and will always show.
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

export function CopyToFormsDialog({
  open,
  onClose,
  templateId,
  fields,
  sectionTitle,
}: {
  open: boolean;
  onClose: () => void;
  templateId: string;
  fields: FormField[];
  sectionTitle: string;
}) {
  const [forms, setForms] = React.useState<FormOption[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [step, setStep] = React.useState<Step>({ kind: "choose" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dropped = React.useMemo(() => copyFieldsWithNewIds(fields).droppedRules, [fields]);

  React.useEffect(() => {
    if (!open) return;
    setStep({ kind: "choose" });
    setChosen(new Set());
    setError(null);
    const controller = new AbortController();
    fetch("/api/admin/form-templates?v1=1", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? "Could not load the forms.");
        const rows = (Array.isArray(body.templates) ? body.templates : []) as FormOption[];
        setForms(rows.filter((row) => row.id !== templateId && !row.archivedAt));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : "Could not load the forms.");
      });
    return () => controller.abort();
  }, [open, templateId]);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/form-templates/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateIds: Array.from(chosen),
          dryRun,
          note: "Questions copied from another form",
          operation: { type: "insert-questions", sectionTitle, fields },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Copy failed (${response.status}).`);
      setStep({ kind: dryRun ? "preview" : "done", response: body as BulkResponse });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed.");
    } finally {
      setBusy(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = (forms ?? []).filter((form) => !needle || form.name.toLowerCase().includes(needle));
  const toggle = (id: string) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else if (next.size < BULK_MAX_FORMS) next.add(id);
    return next;
  });

  return (
    <EModal open={open} onClose={onClose} title={`Copy ${fields.length} question${fields.length === 1 ? "" : "s"} to other forms`} eyebrow="Saved as drafts" wide>
      <div className="space-y-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          They are added to a section called “{sectionTitle}” in each form (created if missing), with new question keys. Each form gets a draft; nothing reaches cleaners until it is published.
        </p>
        {dropped.length > 0 ? (
          <div className={`rounded-[8px] ${toneNoticeClass("attention")} px-3 py-2 text-[0.75rem]`}>
            {dropped.map((rule) => `“${rule.questionLabel}”`).join(", ")} {dropped.length === 1 ? "watches a question" : "watch questions"} that {dropped.length === 1 ? "is" : "are"} not being copied, so {dropped.length === 1 ? "its rule is" : "their rules are"} dropped in the copies and they always show.
          </div>
        ) : null}
        {step.kind === "choose" ? (
          <>
            <EInput type="search" aria-label="Search forms" placeholder="Search forms" value={query} onChange={(event) => setQuery(event.target.value)} />
            {loadError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{loadError}</p> : null}
            {forms === null && !loadError ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Loading forms…</p> : null}
            {forms && visible.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No other forms match.</p> : null}
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {visible.map((form) => (
                <li key={form.id}>
                  <label className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]">
                    <input type="checkbox" className="accent-[hsl(var(--e-primary))]" checked={chosen.has(form.id)} onChange={() => toggle(form.id)} />
                    <span className="min-w-0 flex-1 break-words">{form.name}</span>
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{form.serviceType.replace(/_/g, " ").toLowerCase()} · v{form.version}{form.isActive ? "" : " · not live"}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={onClose}>Cancel</EButton>
              <EButton size="sm" disabled={busy || chosen.size === 0} onClick={() => void run(true)}>
                {busy ? "Checking…" : `Preview ${chosen.size || ""}`.trim()}
              </EButton>
            </div>
          </>
        ) : (
          <>
            <OutcomeRows outcomes={step.response.outcomes} />
            <div className="flex justify-end gap-2">
              {step.kind === "preview" ? (
                <>
                  <EButton variant="outline" size="sm" onClick={() => setStep({ kind: "choose" })}>Back</EButton>
                  <EButton size="sm" disabled={busy || step.response.summary.changed === 0} onClick={() => void run(false)}>
                    {busy ? "Copying…" : `Copy into ${step.response.summary.changed} form${step.response.summary.changed === 1 ? "" : "s"}`}
                  </EButton>
                </>
              ) : (
                <EButton size="sm" onClick={onClose}>Done</EButton>
              )}
            </div>
          </>
        )}
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error} Nothing was changed for forms not listed as saved.</p> : null}
      </div>
    </EModal>
  );
}
