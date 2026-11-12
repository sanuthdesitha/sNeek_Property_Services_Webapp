"use client";

/**
 * "Cancel job" for one job or a selection (Wave E, 2026-11).
 *  One job  → POST /api/admin/jobs/:id/cancel  { reason }
 *  Several  → POST /api/admin/jobs/bulk-cancel  { jobIds, reason } (one outcome per job)
 * A reason is required. The server decides every rule (who, when, invoices,
 * pay, running clocks) and says why when it refuses; nothing here guesses.
 * The released cleaners get an inbox notice; the client is not told.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, ETextarea } from "@/components/v2/admin/estate-kit";
import { CANCEL_REASON_MAX } from "@/lib/jobs/cancel-rules";
import { JobDialog } from "./job-dialog";

type BulkRow = { jobId: string; outcome: "cancelled" | "refused"; message: string };

type Phase =
  | { kind: "editing"; error: string | null }
  | { kind: "saving" }
  | { kind: "done"; lines: string[]; rows: BulkRow[] };

type CancelJobDialogProps = {
  open: boolean;
  jobIds: string[];
  /** Shown for a single job ("The Bondi Studio · Thu 12 Nov"). */
  label?: string;
  onClose: () => void;
  /** After a request that cancelled at least one job; `remaining` = ids not cancelled. */
  onDone: (remaining: string[]) => void;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function CancelJobDialog({ open, jobIds, label, onClose, onDone }: CancelJobDialogProps) {
  const [reason, setReason] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "editing", error: null });
  const key = jobIds.join(",");

  // A different job or selection starts afresh; the same one keeps the draft.
  useEffect(() => {
    setReason("");
    setPhase({ kind: "editing", error: null });
  }, [key]);

  const saving = phase.kind === "saving";
  const single = jobIds.length === 1;

  async function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setPhase({ kind: "editing", error: "Give a reason for cancelling." });
      return;
    }
    setPhase({ kind: "saving" });
    try {
      if (single) {
        const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobIds[0])}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        });
        const body = await readJson(response);
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not cancel the job.");
        const released = Array.isArray(body.released) ? body.released.length : 0;
        const lines = [
          released ? `Cancelled. ${released} cleaner${released === 1 ? "" : "s"} released; an inbox notice was queued.` : "Cancelled.",
          ...(typeof body.noticeError === "string" ? [body.noticeError] : []),
          ...(Array.isArray(body.followUps) ? body.followUps.filter((line): line is string => typeof line === "string") : []),
        ];
        setPhase({ kind: "done", lines, rows: [] });
        onDone([]);
        return;
      }
      const response = await fetch("/api/admin/jobs/bulk-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds, reason: trimmed }),
      });
      const body = await readJson(response);
      if (!response.ok || !Array.isArray(body.rows)) throw new Error(typeof body.error === "string" ? body.error : "Could not cancel the jobs.");
      const rows = body.rows as BulkRow[];
      const cancelled = rows.filter((row) => row.outcome === "cancelled").length;
      setPhase({ kind: "done", lines: [`${cancelled} of ${rows.length} cancelled. The client is not told automatically.`], rows });
      onDone(rows.filter((row) => row.outcome !== "cancelled").map((row) => row.jobId));
    } catch (error) {
      setPhase({ kind: "editing", error: error instanceof Error ? error.message : "Could not cancel. Your reason is still here." });
    }
  }

  return (
    <JobDialog open={open} title={single ? "Cancel job" : `Cancel ${jobIds.length} jobs`} busy={saving} onClose={onClose}>
      <div className="space-y-4">
        {label ? <p className="text-[0.875rem] font-[550]">{label}</p> : null}
        {phase.kind === "done" ? (
          <>
            <ul role="status" className="space-y-1 text-[0.8125rem]">
              {phase.lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {phase.rows.length ? (
              <ul aria-label="Results" className="max-h-64 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] text-[0.8125rem]">
                {phase.rows.map((row) => (
                  <li key={row.jobId} className={`px-3 py-2 [overflow-wrap:anywhere] ${row.outcome === "refused" ? "text-[hsl(var(--e-danger))]" : ""}`}>
                    {row.outcome === "cancelled" ? "Cancelled" : "Not cancelled"} · {row.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end border-t border-[hsl(var(--e-border))] pt-4">
              <EButton onClick={onClose}>Close</EButton>
            </div>
          </>
        ) : (
          <>
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              A cancelled job is never billed, paid or reminded, and leaves the calendar and cleaner lists. Its cleaners are released and told in their inbox. Time and photos already recorded are kept. A job that has started can be cancelled by an administrator only; a job on an invoice or in a pay run cannot be cancelled.
            </p>
            <EField label="Reason (required)">
              <ETextarea value={reason} maxLength={CANCEL_REASON_MAX} disabled={saving} onChange={(event) => setReason(event.target.value)} className="min-h-[5rem]" />
            </EField>
            {phase.kind === "editing" && phase.error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))] [overflow-wrap:anywhere]">{phase.error}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton variant="outline" onClick={onClose} disabled={saving}>Keep job</EButton>
              <EButton variant="danger" onClick={() => void submit()} disabled={saving}>{saving ? "Cancelling…" : single ? "Cancel job" : `Cancel ${jobIds.length} jobs`}</EButton>
            </div>
          </>
        )}
      </div>
    </JobDialog>
  );
}
