"use client";

/**
 * Bulk actions on selected reports: set client / cleaner / laundry
 * visibility, regenerate with the chosen theme, delete (after the shared
 * confirmation). One request to POST /api/admin/reports/bulk; the outcome of
 * every row is shown, and rows that failed stay selected for a retry.
 */
import * as React from "react";
import { EBulkBar, EBulkButton } from "@/components/v2/ui/bulk-bar";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { MAX_BULK_REGENERATE, type ReportBulkResult } from "@/lib/reports/report-bulk-limits";
import { errorText, type VisibilityPatch } from "./report-types";

type VisibilityChoice = { value: string; label: string; patch: VisibilityPatch };

const VISIBILITY_CHOICES: VisibilityChoice[] = [
  { value: "client-show", label: "Show to client", patch: { clientVisible: true } },
  { value: "client-hide", label: "Hide from client", patch: { clientVisible: false } },
  { value: "cleaner-show", label: "Show to cleaner", patch: { cleanerVisible: true } },
  { value: "cleaner-hide", label: "Hide from cleaner", patch: { cleanerVisible: false } },
  { value: "laundry-show", label: "Show to laundry", patch: { laundryVisible: true } },
  { value: "laundry-hide", label: "Hide from laundry", patch: { laundryVisible: false } },
];

export type BulkSummary = { text: string; failures: Array<{ jobId: string; error: string }> };

function isBulkResult(body: unknown): body is ReportBulkResult {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as { results?: unknown }).results);
}

export function ReportBulkActions({
  selected,
  themeId,
  themeName,
  onClear,
  onDone,
}: {
  selected: string[];
  themeId: string | null;
  themeName: string;
  onClear: () => void;
  /** Called with the job ids that failed (to keep selected) and a summary to show. */
  onDone: (failedIds: string[], summary: BulkSummary) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [choice, setChoice] = React.useState(VISIBILITY_CHOICES[0].value);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  async function run(body: Record<string, unknown>, verb: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/reports/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, jobIds: selected }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok || !isBulkResult(result)) {
        onDone(selected, { text: `Nothing was ${verb}: ${errorText(result, "the request failed")}.`, failures: [] });
        return;
      }
      const failures = result.results.flatMap((row) => (row.ok ? [] : [{ jobId: row.jobId, error: row.error }]));
      const text = `${result.succeeded} ${verb}${result.failed ? `, ${result.failed} failed` : ""}.`;
      onDone(failures.map((row) => row.jobId), { text, failures });
    } catch (cause) {
      onDone(selected, { text: `Nothing was ${verb}: ${cause instanceof Error ? cause.message : "network error"}.`, failures: [] });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const visibility = VISIBILITY_CHOICES.find((item) => item.value === choice) ?? VISIBILITY_CHOICES[0];
  const tooManyToRegenerate = selected.length > MAX_BULK_REGENERATE;

  return (
    <>
      <EBulkBar
        count={selected.length}
        noun={{ one: "report", many: "reports" }}
        onClear={onClear}
        busy={busy}
        note={tooManyToRegenerate ? `Regenerate takes at most ${MAX_BULK_REGENERATE} at a time.` : `Regenerate uses: ${themeName}.`}
      >
        <label className="sr-only" htmlFor="report-bulk-visibility">Visibility to set</label>
        <select
          id="report-bulk-visibility"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          className="h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-sidebar-hairline))] bg-transparent px-2 text-[0.75rem] text-[hsl(var(--e-sidebar-active-bg))]"
        >
          {VISIBILITY_CHOICES.map((item) => (
            <option key={item.value} value={item.value} className="text-black">
              {item.label}
            </option>
          ))}
        </select>
        <EBulkButton onClick={() => void run({ action: "visibility", patch: visibility.patch }, "updated")}>Apply</EBulkButton>
        <EBulkButton disabled={tooManyToRegenerate} onClick={() => void run({ action: "regenerate", themeId }, "regenerated")}>
          Regenerate
        </EBulkButton>
        <EBulkButton onClick={() => setConfirmDelete(true)}>Delete</EBulkButton>
      </EBulkBar>
      <EConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete reports"
        description={`This removes the generated report file and metadata for ${selected.length} selected ${selected.length === 1 ? "report" : "reports"}.`}
        confirmLabel={busy ? "Deleting…" : "Delete reports"}
        loading={busy}
        onConfirm={() => run({ action: "delete", confirm: true }, "deleted")}
      />
    </>
  );
}
