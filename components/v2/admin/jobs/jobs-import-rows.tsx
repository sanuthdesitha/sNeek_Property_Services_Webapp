"use client";

/**
 * Row lists for the Jobs CSV import: the check (every row with what it will
 * create or why it is refused) and the result (created, already created from
 * this file, refused, failed, plus the cleaner assignment outcome).
 */
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { ImportRow } from "@/lib/jobs/csv-import";
import type { ImportApplyOutcome, ImportApplyRow } from "@/lib/jobs/csv-import-server";

export type AssignState = { status: "saving" } | { status: "done" } | { status: "failed"; message: string };

const OUTCOME: Record<ImportApplyOutcome, { label: string; tone: EPillTone }> = {
  created: { label: "Created", tone: "ok" },
  already_created: { label: "Already created", tone: "info" },
  refused: { label: "Not created", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
};

function when(row: ImportRow): string {
  const values = row.values;
  if (!values) return row.raw.date || "No date";
  const time = values.startTime ? ` ${values.startTime}${values.dueTime ? `–${values.dueTime}` : ""}` : "";
  return `${values.date}${time}`;
}

export function ImportPreviewList({ rows }: { rows: ImportRow[] }) {
  const valid = rows.filter((row) => row.ok).length;
  return (
    <>
      <p role="status">{valid} of {rows.length} row{rows.length === 1 ? "" : "s"} can be created{rows.length - valid ? `; ${rows.length - valid} will be skipped with the reason shown` : ""}. Nothing has been created yet.</p>
      <ul aria-label="Import check" className="max-h-72 space-y-2 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.line} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words font-[600]">Row {row.line}: {row.values?.propertyName ?? (row.raw.property || "No property")}</span>
              <EPill tone={row.ok ? "ok" : "bad"}>{row.ok ? "Ready" : "Will be skipped"}</EPill>
            </div>
            <p className="e-tnum mt-1 text-[hsl(var(--e-muted-foreground))]">
              {when(row)} · {row.values?.jobType.replace(/_/g, " ").toLowerCase() ?? (row.raw.job_type || "no job type")}
              {row.values?.cleanerName ? ` · ${row.values.cleanerName}` : ""}
            </p>
            {row.errors.map((text) => <p key={text} className="mt-1 text-[hsl(var(--e-danger))]">{text}</p>)}
          </li>
        ))}
      </ul>
    </>
  );
}

function assignText(state: AssignState | undefined): string | null {
  if (!state) return null;
  if (state.status === "saving") return "Assigning the cleaner…";
  if (state.status === "done") return "Cleaner assigned.";
  return `Cleaner not assigned: ${state.message}`;
}

export function ImportResultList({ rows, assigns }: { rows: ImportApplyRow[]; assigns: Record<number, AssignState> }) {
  const created = rows.filter((row) => row.outcome === "created").length;
  const again = rows.filter((row) => row.outcome === "already_created").length;
  return (
    <>
      <p role="status">{created} created{again ? `, ${again} already created from this file earlier` : ""}, {rows.length - created - again} not created.</p>
      <ul aria-label="Import results" className="max-h-72 space-y-2 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.line} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-[600]">Row {row.line}{row.jobNumber ? ` · ${row.jobNumber}` : ""}</span>
              <EPill tone={OUTCOME[row.outcome].tone}>{OUTCOME[row.outcome].label}</EPill>
            </div>
            {row.outcome !== "created" ? <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">{row.message}</p> : null}
            {assignText(assigns[row.line]) ? <p className="mt-1" role="status">{assignText(assigns[row.line])}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
