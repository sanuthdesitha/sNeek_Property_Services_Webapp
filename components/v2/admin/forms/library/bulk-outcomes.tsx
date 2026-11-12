"use client";

/**
 * Per-form result of a bulk preview or apply: what changes (before → after for
 * each affected question) or why a form was left alone. A refused or unchanged
 * form is always listed, never folded into a success count.
 */
import * as React from "react";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { BulkFormOutcome, BulkOutcomeStatus, BulkResponse } from "@/lib/forms/template-bulk-types";

const STATUS: Record<BulkOutcomeStatus, { label: string; tone: EPillTone }> = {
  "would-change": { label: "Will change", tone: "info" },
  changed: { label: "Done", tone: "ok" },
  unchanged: { label: "Not changed", tone: "neutral" },
  refused: { label: "Not done", tone: "bad" },
};

const PROPERTY_LABEL: Record<string, string> = {
  label: "Label",
  helpText: "Help text",
  required: "Required",
  minPhotos: "Minimum photos",
  maxFiles: "Maximum files",
  severity: "Priority",
  detailsWhenNo: "Details when No",
  options: "Options",
  title: "Section title",
  description: "Description",
  instructions: "Instructions",
  placeholder: "Placeholder",
  section: "New section",
  question: "New question",
  group: "Group",
  tags: "Tags",
  version: "Version",
  status: "Status",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

function OutcomeRow({ outcome }: { outcome: BulkFormOutcome }) {
  const status = STATUS[outcome.status];
  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-[600] text-[hsl(var(--e-foreground))]">{outcome.name}</span>
        <EPill tone={status.tone}>{status.label}</EPill>
        {outcome.draftSaved ? <EPill tone="gold">Saved as draft</EPill> : null}
      </div>
      {outcome.reason ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{outcome.reason}</p> : null}
      {outcome.changes.length > 0 ? (
        <ul className="space-y-1 text-[0.8125rem]">
          {outcome.changes.map((change, index) => (
            <li key={`${change.fieldId ?? "form"}-${change.property}-${index}`} className="break-words">
              <span className="text-[hsl(var(--e-muted-foreground))]">
                {change.sectionTitle ? `${change.sectionTitle}: ` : ""}
                {change.fieldLabel} · {PROPERTY_LABEL[change.property] ?? change.property}
              </span>{" "}
              <span className="line-through decoration-[hsl(var(--e-danger))]">{show(change.before)}</span>
              {" → "}
              <span className="font-[600]">{show(change.after)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function BulkOutcomes({ response, title }: { response: BulkResponse; title: string }) {
  const { summary } = response;
  return (
    <section aria-label={title} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised)/0.5)] px-3">
      <p className="border-b border-[hsl(var(--e-border))] py-2 text-[0.8125rem] font-[600]" role="status">
        {title}: {summary.changed} {response.dryRun ? "will change" : "done"}, {summary.unchanged} not changed, {summary.refused} not done
      </p>
      <ul className="max-h-[22rem] divide-y divide-[hsl(var(--e-border))] overflow-y-auto">
        {response.outcomes.map((outcome) => (
          <OutcomeRow key={outcome.templateId} outcome={outcome} />
        ))}
      </ul>
    </section>
  );
}
