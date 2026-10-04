"use client";
import { useState } from "react";
import type { StartedWorkReview } from "@/lib/billing/started-work-reconciliation";

const sydneyDate = (value: string) => new Date(value).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" });

export function StartedWorkReviewPanel({ invoiceId, status, updatedAt, review, inspection, onUpdated }: {
  invoiceId: string; status: string; updatedAt: string; review: StartedWorkReview;
  inspection?: { requiresReview: boolean; changedJobIds: string[]; error?: string } | null;
  onUpdated: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function act(action: "REFRESH" | "CONFIRM") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/started-work-review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedUpdatedAt: updatedAt, ...(action === "CONFIRM" ? { evidenceNote: note.trim() } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Review could not be saved.");
      await onUpdated();
      setMessage(action === "REFRESH" ? "Draft refreshed. Check the revised amounts, then confirm your review." : "Office review recorded. No invoice was sent, paid or exported.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Review could not be saved."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded border p-4" aria-label="Started work review">
    <h3 className="font-semibold">Started-work draft review</h3>
    <p className="text-sm">Unfinished work uses the full agreed client price as a provisional estimate. The closed period is {sydneyDate(review.periodStart)} to {sydneyDate(review.periodEnd)} (Sydney boundaries). Earlier uninvoiced work is labeled below. Cleaner pay remains a separate approval.</p>
    <ul className="text-sm">{review.jobs.map(job => <li key={job.jobId}>{job.jobNumber || job.jobId}: ${job.agreedAmount.toFixed(2)} · {job.unfinishedAtCutoff ? "unfinished at cutoff — provisional" : "completed by cutoff"}{job.priorPeriodCarryover ? " · prior-period carryover" : ""}</li>)}</ul>
    {inspection?.error ? <p role="alert">{inspection.error}</p> : null}
    {inspection?.changedJobIds.length ? <p role="alert">Completion or billing changed for {inspection.changedJobIds.length} job(s). {status === "DRAFT" ? "Refresh and review the draft." : "Review a manual correction; this issued snapshot has not been changed."}</p> : null}
    {status === "DRAFT" ? <>
      <p className="text-sm">Refresh pulls current agreed job prices and billing extras into this draft only. Check all amounts before confirming. Confirm a current office review, then explicitly approve the draft before sending, recording payment or exporting.</p>
      <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={() => act("REFRESH")}>Refresh draft from jobs</button>
      <label className="block text-sm">Review evidence and pricing decision<textarea className="block w-full rounded border p-2" value={note} onChange={event => setNote(event.target.value)} /></label>
      <button type="button" className="rounded border px-3 py-2" disabled={busy || note.trim().length < 10 || Boolean(inspection?.changedJobIds.length) || Boolean(inspection?.error)} onClick={() => act("CONFIRM")}>Confirm reviewed provisional amounts</button>
      {!review.required && !inspection?.requiresReview ? <p className="text-sm">Office review recorded. This remains a draft until an explicit financial action.</p> : null}
    </> : <p className="text-sm">Approved or issued invoices are never refreshed here. Use the office correction process for later completion or extras.</p>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
