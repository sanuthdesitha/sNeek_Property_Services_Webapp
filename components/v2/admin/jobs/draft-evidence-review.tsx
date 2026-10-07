"use client";

import * as React from "react";
import { ExternalLink, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import type { EvidenceDestination } from "@/lib/cleaner/evidence-destination";

type Row = {
  key: string; name: string; previewUrl: string | null; version: string; removed: boolean; issues: string[];
  source: { jobId: string | null; captureId: string | null; userId: string; legacy: boolean } | null;
  locations: EvidenceDestination[];
  receipts: Array<{ id: string; formRevision: string; draftIdentity: string; detached?: boolean; resolution?: { at: string; reason: string } }>;
};
type Review = { comparisonWarning?: string | null; jobId: string; locked: boolean; rows: Row[]; history: Array<{ id: string; action: string; createdAt: string; user: { name: string | null }; after: { reason?: string } | null }> };
function locationLabel(value: EvidenceDestination) {
  return value.type === "bulkPool" ? "Unassigned bulk photos" : value.type === "formField" ? `Form section: ${value.fieldId}` : value.type === "jobTask" ? `Job task: ${value.taskId}` : value.type === "laundry" ? "Laundry" : "New follow-up task";
}
export function DraftEvidenceReview({ jobId }: { jobId: string }) {
  const [review, setReview] = React.useState<Review | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reasons, setReasons] = React.useState<Record<string, string>>({});
  const busyRef = React.useRef(false);
  const jobRef = React.useRef(jobId); jobRef.current = jobId;
  const requestRef = React.useRef(0);
  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/evidence-review`, { cache: "no-store" });
      const body = await response.json();
      if (request !== requestRef.current || jobRef.current !== jobId) return;
      if (!response.ok || body.jobId !== jobId || !Array.isArray(body.rows) || !Array.isArray(body.history)) throw new Error(body.error || "Could not load draft evidence.");
      setReview(body);
    } catch (err) {
      if (request === requestRef.current && jobRef.current === jobId) { setReview(null); setError(err instanceof Error ? err.message : "Could not load draft evidence."); }
    } finally { if (request === requestRef.current && jobRef.current === jobId) setLoading(false); }
  }, [jobId]);
  const invalidateRequests = React.useCallback(() => { ++requestRef.current; }, []);
  React.useEffect(() => { setReview(null); setReasons({}); setNotice(null); void load(); return invalidateRequests; }, [load, invalidateRequests]);

  async function discard(row: Row) {
    if (busyRef.current || loading || !review || review.locked || row.removed) return;
    const reason = (reasons[row.key] ?? "").trim();
    if (reason.length < 10) return;
    if (!window.confirm("Remove this reference from this job's draft only? The original photo, capture provenance and all submitted records will remain unchanged. Your reason and identity will be recorded. This does not approve or move the photo to another job.")) return;
    busyRef.current = true; setBusy(row.key); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/evidence-review`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DISCARD_DRAFT_REFERENCE", key: row.key, version: row.version, reason }) });
      const body = await response.json();
      if (jobRef.current !== jobId) return;
      if (!response.ok || body.ok !== true || body.key !== row.key || !(body.discardedReference === true || body.alreadyRemoved === true)) throw new Error(body.error || "Resolution was not confirmed. Refresh before retrying.");
      setReview(current => current && ({ ...current, rows: current.rows.map(item => item.key === row.key ? { ...item, removed: true } : item) }));
      setNotice("Draft reference removed. Originals and submitted evidence are unchanged. The cleaner should refresh the job.");
      await load();
    } catch (err) { if (jobRef.current === jobId) setError(err instanceof Error ? err.message : "Resolution was not confirmed."); }
    finally { busyRef.current = false; setBusy(null); }
  }

  return <ECard id="draft-evidence-review">
    <ECardHeader><ECardTitle className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="h-5 w-5" /> Draft evidence review</ECardTitle></ECardHeader>
    <ECardBody className="space-y-4">
      <p className="text-sm text-[hsl(var(--e-text-secondary))]">Review unsubmitted photos and capture-context conflicts. Office overrides remove a reference from this draft only; they never adopt historical photos as new proof, delete originals or change submitted records.</p>
      <EButton type="button" variant="outline" className="min-h-11" disabled={loading || busy !== null} onClick={() => void load()}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Refresh evidence</EButton>
      {loading ? <p role="status">Loading draft evidence…</p> : null}
      {error ? <p role="alert" className="text-sm text-[hsl(var(--e-danger))]">{error}</p> : null}
      {notice ? <p role="status" className="text-sm">{notice}</p> : null}
      {review?.comparisonWarning ? <p role="status" className="text-sm">{review.comparisonWarning}</p> : null}
      {review?.locked ? <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3 text-sm">This job is submitted or finished. Review is read-only; submitted evidence cannot be overridden here.</p> : null}
      {review && !review.rows.length ? <p>No saved draft evidence to review.</p> : null}
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        {review?.rows.map(row => <article key={row.key} className="min-w-0 space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <div className="flex items-start gap-3">
            {row.previewUrl ? <a href={row.previewUrl} target="_blank" rel="noreferrer" aria-label={`View original ${row.name}`} className="shrink-0 rounded focus-visible:outline focus-visible:outline-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.previewUrl} alt={row.name} loading="lazy" className="h-24 w-24 rounded object-cover" />
            </a> : null}
            <div className="min-w-0 space-y-1"><p className="break-words font-semibold">{row.name}</p><EBadge tone={row.removed ? "neutral" : row.issues.length ? "warning" : "info"}>{row.removed ? "Removed from draft" : row.issues.length ? "Needs review" : "Draft attachment"}</EBadge>
              {row.locations.map((location, index) => <p key={index} className="break-words text-xs">{locationLabel(location)}</p>)}
            </div>
          </div>
          {row.issues.length ? <ul className="list-inside list-disc text-sm">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
          <details className="text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Original provenance</summary>
            <dl className="space-y-2 break-all"><dt className="font-medium">Original storage key</dt><dd>{row.key}</dd><dt className="font-medium">Source job</dt><dd>{row.source?.jobId ? <a href={`/v2/admin/jobs/${encodeURIComponent(row.source.jobId)}?tab=forms`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 underline">{row.source.jobId}<ExternalLink aria-hidden="true" className="h-3 w-3" /></a> : "Not recorded in the legacy key"}</dd><dt className="font-medium">Uploaded by (recorded user ID)</dt><dd>{row.source?.userId ?? "Unknown"}</dd><dt className="font-medium">Capture ID</dt><dd>{row.source?.captureId ?? "Not recorded"}</dd></dl>
            <p className="mt-2">Capture time is not available from this receipt. Any original photo stamp is unchanged.</p>
            {row.receipts.map(receipt => <div key={receipt.id} className="mt-2 space-y-1 break-all border-t border-[hsl(var(--e-border))] pt-2"><p>Receipt: {receipt.id}</p><p>Recorded form version: {receipt.formRevision}</p><p>Recorded account context: {receipt.draftIdentity}</p>{receipt.resolution ? <p>Reference discarded {new Date(receipt.resolution.at).toLocaleString()}: {receipt.resolution.reason}</p> : null}</div>)}
          </details>
          {!review.locked && !row.removed ? <div className="space-y-2">
            <label className="block text-sm font-medium">Reason for discarding {row.name}<ETextarea value={reasons[row.key] ?? ""} maxLength={1000} disabled={busy !== null} className="mt-1 w-full" placeholder="Explain why this reference does not belong in the draft (at least 10 characters)." onChange={event => setReasons(current => ({ ...current, [row.key]: event.target.value }))} /></label>
            <EButton type="button" variant="outline" className="min-h-11 h-auto w-full whitespace-normal text-[hsl(var(--e-danger))]" disabled={loading || busy !== null || (reasons[row.key] ?? "").trim().length < 10} onClick={() => void discard(row)}><Trash2 aria-hidden="true" className="h-4 w-4 shrink-0" />{busy === row.key ? "Saving resolution…" : "Discard draft reference"}</EButton>
          </div> : null}
        </article>)}
      </div>
      {review?.history.length ? <details><summary className="min-h-11 cursor-pointer py-3 font-medium">Resolution history (latest 50)</summary><ol className="space-y-3 text-sm">{review.history.map(item => <li key={item.id} className="rounded border border-[hsl(var(--e-border))] p-3"><p>{item.user.name ?? "Office user"} · {new Date(item.createdAt).toLocaleString()}</p><p>{item.action === "OFFICE_DISCARD_DRAFT_REFERENCE" ? "Office draft-reference override" : "Cleaner discarded a wrong reference"}</p><p className="break-words">{item.after?.reason}</p></li>)}</ol></details> : null}
    </ECardBody>
  </ECard>;
}
