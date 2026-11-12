"use client";

/**
 * Edit controls for one answer and the laundry fields, with the classic
 * Submissions dialog's rules: a checkbox is a switch, long text a textarea,
 * a number a number box, anything else a text box; photo, video, file and
 * signature answers are managed in the media section. Structured answers
 * (table, stock count, lists) are shown read-only here: a text box would turn
 * them into "[object Object]", which the classic dialog could do.
 */
import * as React from "react";
import { EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { isUploadFieldType } from "@/lib/forms/field-types";
import type { SubmissionField } from "@/lib/forms/submission-detail";
import { TableAnswer, inlineAnswerText, isBlockAnswer } from "./structured-answer";

export type LaundryDraft = { laundryReady: boolean | null; laundryOutcome: string; bagLocation: string };

const LAUNDRY_OUTCOMES: Array<[string, string]> = [
  ["", "Not set"],
  ["READY_FOR_PICKUP", "Ready for pickup"],
  ["NOT_READY", "Not ready"],
  ["NO_PICKUP_REQUIRED", "No pickup required"],
];

const LOCKED_TYPES = new Set(["signature", "table", "stock_count", "inventory", "multiselect", "location", "device_status"]);

/** Answers the office may edit here (the others are shown read-only). */
export function isEditableAnswer(field: SubmissionField): boolean {
  return !field.id.startsWith("__") && !isUploadFieldType(field.type) && !LOCKED_TYPES.has(field.type);
}

export function AnswerEditor({ field, value, onChange }: { field: SubmissionField; value: unknown; onChange: (value: unknown) => void }) {
  const id = React.useId();
  if (isUploadFieldType(field.type) || field.type === "signature") {
    return <p className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] px-2.5 py-1.5 text-[hsl(var(--e-muted-foreground))]">Manage this answer in the media section below.</p>;
  }
  if (!isEditableAnswer(field) || (value !== null && typeof value === "object")) {
    return (
      <div className="space-y-1">
        {isBlockAnswer(field) ? <TableAnswer field={field} value={value} /> : <p className="font-[550]">{inlineAnswerText(field, value)}</p>}
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Not editable here; only the cleaner&apos;s form records this kind of answer.</p>
      </div>
    );
  }
  if (field.type === "checkbox") {
    return <ESwitch checked={value === true} onCheckedChange={(checked) => onChange(checked)} label={value === true ? "Checked" : "Unchecked"} />;
  }
  if (field.type === "textarea" || field.type === "longtext") {
    return <ETextarea id={id} aria-label={field.label} rows={3} value={typeof value === "string" ? value : value == null ? "" : String(value)} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.type === "number") {
    return <EInput id={id} aria-label={field.label} type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))} />;
  }
  return <EInput id={id} aria-label={field.label} value={value === undefined || value === null ? "" : String(value)} onChange={(event) => onChange(event.target.value)} />;
}

export function LaundryFields({ editing, saving, value, onChange }: { editing: boolean; saving: boolean; value: LaundryDraft; onChange: (next: LaundryDraft) => void }) {
  const readyLabel = value.laundryReady === null ? "Not set" : value.laundryReady ? "Ready" : "Not ready";
  const outcomeLabel = LAUNDRY_OUTCOMES.find(([key]) => key === value.laundryOutcome)?.[1] ?? value.laundryOutcome;
  if (!editing) {
    return (
      <dl className="grid grid-cols-3 gap-2">
        <div><dt className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Laundry ready</dt><dd>{readyLabel}</dd></div>
        <div><dt className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Laundry outcome</dt><dd>{outcomeLabel || "Not set"}</dd></div>
        <div><dt className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Bag location</dt><dd className="[overflow-wrap:anywhere]">{value.bagLocation || "Not set"}</dd></div>
      </dl>
    );
  }
  return (
    <fieldset disabled={saving} className="grid gap-2 sm:grid-cols-3">
      <legend className="sr-only">Laundry</legend>
      <label className="flex flex-col gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
        Laundry ready
        <ESelect value={value.laundryReady === null ? "unset" : value.laundryReady ? "yes" : "no"} onChange={(event) => onChange({ ...value, laundryReady: event.target.value === "unset" ? null : event.target.value === "yes" })}>
          <option value="unset">Not set</option>
          <option value="yes">Ready</option>
          <option value="no">Not ready</option>
        </ESelect>
      </label>
      <label className="flex flex-col gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
        Laundry outcome
        <ESelect value={value.laundryOutcome} onChange={(event) => onChange({ ...value, laundryOutcome: event.target.value })}>
          {LAUNDRY_OUTCOMES.map(([key, label]) => <option key={key || "none"} value={key}>{label}</option>)}
        </ESelect>
      </label>
      <label className="flex flex-col gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
        Bag location
        <EInput value={value.bagLocation} maxLength={200} onChange={(event) => onChange({ ...value, bagLocation: event.target.value })} />
      </label>
    </fieldset>
  );
}
