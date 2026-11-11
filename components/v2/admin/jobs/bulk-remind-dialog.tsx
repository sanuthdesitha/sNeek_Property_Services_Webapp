"use client";

/**
 * Send reminders for selected jobs through ONE request
 * (`POST /api/admin/jobs/bulk-remind`) and show each job's outcome. A push
 * that was requested or an email the provider accepted is reported as such,
 * never as delivered. Jobs that were not reminded stay selected.
 */
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { BulkRemindResponse, BulkReminderOutcome } from "@/lib/jobs/job-reminder";
import { JobDialog } from "./job-dialog";

type RemindDialogProps = {
  open: boolean;
  jobIds: string[];
  onClose: () => void;
  /** Called with the ids that were NOT reminded (to keep selected). */
  onFinished: (notReminded: string[]) => void;
};

const OUTCOME: Record<BulkReminderOutcome, { label: string; tone: EPillTone }> = {
  requested: { label: "Requested", tone: "ok" },
  partial: { label: "Partly sent", tone: "warn" },
  failed: { label: "Not sent", tone: "bad" },
  skipped: { label: "Skipped", tone: "neutral" },
  not_found: { label: "Not found", tone: "bad" },
};

function isBulkRemindResponse(value: unknown): value is BulkRemindResponse {
  const body = value as BulkRemindResponse | null;
  return Boolean(body) && Array.isArray(body?.rows) && typeof body?.summary === "object";
}

export function BulkRemindDialog({ open, jobIds, onClose, onFinished }: RemindDialogProps) {
  const [method, setMethod] = useState<"PUSH" | "EMAIL">("PUSH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BulkRemindResponse | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (open) { setResult(null); setError(""); }
  }, [open]);

  async function send() {
    if (busy || jobIds.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/jobs/bulk-remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds, method }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!alive.current) return;
      if (!response.ok || !isBulkRemindResponse(body)) {
        const message = (body as { error?: string } | null)?.error;
        setError(response.status === 403 ? "This account cannot send reminders." : message || "Reminders could not be sent. Nothing was confirmed; check the job activity before retrying.");
        return;
      }
      setResult(body);
      onFinished(body.rows.filter((row) => row.outcome !== "requested").map((row) => row.jobId));
    } catch {
      if (alive.current) setError("The outcome is unknown. Check each job's activity before sending again.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <JobDialog open={open} title="Send reminders" busy={busy} onClose={onClose}>
      <div className="space-y-4 text-[0.8125rem]">
        {!result ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Method</span>
              <select aria-label="Reminder method" disabled={busy} value={method} onChange={(event) => setMethod(event.target.value as "PUSH" | "EMAIL")}
                className="h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3">
                <option value="PUSH">Push notification</option>
                <option value="EMAIL">Email</option>
              </select>
            </label>
            <p>Reminds the assigned cleaners on the {jobIds.length} selected job{jobIds.length === 1 ? "" : "s"} to finish and submit their checklist. Jobs that are not paused, in progress or submitted are skipped and listed.</p>
            {error ? <p role="alert">{error}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
              <EButton onClick={() => void send()} disabled={busy}>{busy ? "Sending…" : "Send reminders"}</EButton>
            </div>
          </>
        ) : (
          <>
            <p role="status">
              {result.summary.requested + result.summary.partial} of {result.rows.length} reminded
              {result.summary.skipped ? `, ${result.summary.skipped} skipped` : ""}
              {result.summary.failed + result.summary.notFound ? `, ${result.summary.failed + result.summary.notFound} not sent` : ""}.
              {" "}{result.method === "PUSH" ? "A requested push is not proof the phone received it." : "Accepted by the email provider is not proof of delivery."}
            </p>
            <ul aria-label="Reminder results" className="max-h-72 space-y-2 overflow-y-auto">
              {result.rows.map((row) => (
                <li key={row.jobId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-[600]">{row.label}</span>
                    <EPill tone={OUTCOME[row.outcome].tone}>{OUTCOME[row.outcome].label}</EPill>
                  </div>
                  <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">{row.message}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-[hsl(var(--e-border))] pt-4">
              <EButton onClick={onClose}>Done</EButton>
            </div>
          </>
        )}
      </div>
    </JobDialog>
  );
}
