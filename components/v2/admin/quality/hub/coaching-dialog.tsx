"use client";

/**
 * "Start coaching" from a cleaner row: creates a record through the EXISTING
 * coaching route (POST /api/admin/accountability/coaching), pre-filled from
 * the recurring-issue pattern that suggested it (pattern key and issue ids
 * are attached, as the route accepts). A record is a manager's
 * recommendation; the cleaner acknowledges it in their portal. The draft is
 * kept if saving fails; fields freeze while saving.
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { LabeledField } from "./labeled-field";
import type { CleanerRow } from "./hub-types";

const TYPES = [
  { key: "COACHING", label: "Coaching" },
  { key: "WARNING", label: "Warning" },
  { key: "MANAGEMENT_REVIEW", label: "Management review" },
] as const;
type CoachingType = (typeof TYPES)[number]["key"];

function suggestedReason(row: CleanerRow): string {
  const suggestion = row.coachingSuggestion;
  if (!suggestion) return "";
  return `${suggestion.label} flagged ${suggestion.count} times in the last ${suggestion.windowDays} days.`;
}

export function CoachingDialog({ row, onClose, onCreated }: { row: CleanerRow; onClose: () => void; onCreated: () => void }) {
  const [type, setType] = React.useState<CoachingType>("COACHING");
  const [reason, setReason] = React.useState(() => suggestedReason(row));
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setProblem("A reason is required.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/api/admin/accountability/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerId: row.cleanerId,
          type,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          issueIds: row.coachingSuggestion?.issueIds ?? undefined,
          patternKey: row.coachingSuggestion?.patternKey ?? undefined,
        }),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = (body as { error?: unknown }).error;
        setProblem(typeof error === "string" && error ? error : "The coaching record could not be created.");
        return;
      }
      toast({ title: "Coaching record created", description: `${row.name} will see it in their portal.` });
      onCreated();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "The coaching record could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open onClose={busy ? () => undefined : onClose} eyebrow="Coaching" title={`Start coaching · ${row.name}`}>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">New coaching record</legend>
        {row.coachingSuggestion ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            Suggested by a recurring issue: {row.coachingSuggestion.label} ({row.coachingSuggestion.count} in{" "}
            {row.coachingSuggestion.windowDays} days). The {row.coachingSuggestion.issueIds.length} issue
            {row.coachingSuggestion.issueIds.length === 1 ? "" : "s"} behind it will be linked.
          </p>
        ) : null}
        <LabeledField label="Type">
          <ESelect value={type} onChange={(event) => setType(event.target.value as CoachingType)}>
            {TYPES.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </ESelect>
        </LabeledField>
        <LabeledField label="Reason">
          <ETextarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
        </LabeledField>
        <LabeledField label="Notes (optional)">
          <ETextarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </LabeledField>
        {problem ? (
          <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <EButton size="sm" variant="outline" onClick={onClose}>
            Cancel
          </EButton>
          <EButton size="sm" onClick={() => void submit()}>
            {busy ? "Saving…" : "Create coaching record"}
          </EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
