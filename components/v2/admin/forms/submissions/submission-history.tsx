"use client";

/**
 * The edit history of a submission, newest first: answer edits with what each
 * answer was before and after, media removed (original kept), added and
 * restored. Read from the audit rows the server writes with every change.
 */
import { format } from "date-fns";
import type { SubmissionHistoryEntry } from "@/lib/forms/submission-detail";

const ACTION_LABEL: Record<string, string> = {
  FORM_SUBMISSION_EDITED: "Answers edited",
  FORM_SUBMISSION_MEDIA_REMOVED: "Photo removed (original kept)",
  FORM_SUBMISSION_MEDIA_ADDED: "Photos added",
  FORM_SUBMISSION_MEDIA_RESTORED: "Photo restored",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function changeLines(entry: SubmissionHistoryEntry): string[] {
  if (entry.action !== "FORM_SUBMISSION_EDITED") return [];
  const before = (entry.before ?? {}) as { answers?: Record<string, unknown>; laundry?: Record<string, unknown> };
  const after = (entry.after ?? {}) as { answers?: Record<string, unknown>; laundry?: Record<string, unknown> };
  const lines: string[] = [];
  for (const [key, value] of Object.entries(after.answers ?? {})) lines.push(`${key}: ${show(before.answers?.[key])} → ${show(value)}`);
  for (const [key, value] of Object.entries(after.laundry ?? {})) lines.push(`${key}: ${show(before.laundry?.[key])} → ${show(value)}`);
  return lines;
}

export function SubmissionHistory({ entries }: { entries: SubmissionHistoryEntry[] }) {
  return (
    <section aria-label="Edit history" className="space-y-1.5">
      <p className="e-eyebrow">History</p>
      {entries.length === 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Not edited since the cleaner submitted it.</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="text-[0.75rem]">
              <p><span className="font-[600]">{ACTION_LABEL[entry.action] ?? entry.action}</span> · {entry.actor} · {format(new Date(entry.at), "d MMM yyyy HH:mm")}</p>
              {changeLines(entry).map((line) => <p key={line} className="pl-3 text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{line}</p>)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
