"use client";
import { MediaGallery } from "@/components/shared/media-gallery";

import { useRestorableState } from "@/hooks/use-restorable-state";

import * as React from "react";
import { ChevronDown, ExternalLink, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import type { EvidenceDestination } from "@/lib/cleaner/evidence-destination";

type Row = {
  key: string; name: string; previewUrl: string | null; version: string; removed: boolean; issues: string[];
  source: { jobId: string | null; captureId: string | null; userId: string; legacy: boolean } | null;
  locations: EvidenceDestination[];
  receipts: Array<{ captureContext?: { formRevision: string; draftIdentity: string }; id: string; formRevision: string; draftIdentity: string; detached?: boolean; resolution?: { at: string; reason: string } }>;
};
type Review = { comparisonWarning?: string | null; jobId: string; locked: boolean; rows: Row[]; history: Array<{ id: string; action: string; createdAt: string; user: { name: string | null }; after: { reason?: string } | null }> };
type Result = { key: string; name: string; text: string };
const PAGE_SIZE = 8;
function locationLabel(value: EvidenceDestination) {
  return value.type === "bulkPool" ? "Bulk photos" : value.type === "formField" ? `Section: ${value.fieldId}` : value.type === "jobTask" ? `Task: ${value.taskId}` : value.type === "laundry" ? "Laundry" : "Follow-up task";
}
export function DraftEvidenceReview({ jobId }: { jobId: string }) {
  const [review, setReview] = React.useState<Review | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [filter, setFilter] = useRestorableState("draft-evidence-review:filter", "active");
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const busyRef = React.useRef(false);
  const stopRef = React.useRef(false);
  const jobRef = React.useRef(jobId); jobRef.current = jobId;
  const requestRef = React.useRef(0);
  const panelId = React.useId();
  const load = React.useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true); setError(null); setSelected([]); setReason("");
    try {
      const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/evidence-review`, { cache: "no-store" });
      const body = await response.json();
      if (request !== requestRef.current || jobRef.current !== jobId) return;
      if (!response.ok || body.jobId !== jobId || !Array.isArray(body.rows) || !Array.isArray(body.history)) throw new Error(body.error || "Could not load draft evidence.");
      setReview(body); setPage(0);
    } catch (err) {
      if (request === requestRef.current && jobRef.current === jobId) { setReview(null); setError(err instanceof Error ? err.message : "Could not load draft evidence."); }
    } finally { if (request === requestRef.current && jobRef.current === jobId) setLoading(false); }
  }, [jobId]);
  const invalidateRequests = React.useCallback(() => { ++requestRef.current; stopRef.current = true; }, []);
  React.useEffect(() => { setReview(null); setNotice(null); setResults([]); setExpanded(false); void load(); return invalidateRequests; }, [load, invalidateRequests]);

  const filtered = (review?.rows ?? []).filter(row => filter === "removed" ? row.removed : !row.removed && (filter !== "issues" || row.issues.length > 0));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const eligible = review?.locked ? [] : visible.filter(row => !row.removed);
  const selectedRows = eligible.filter(row => selected.includes(row.key));
  const clearSelection = () => { setSelected([]); setReason(""); };

  async function discardSelected() {
    if (busyRef.current || loading || !review || review.locked || !selectedRows.length) return;
    const sharedReason = reason.trim();
    if (sharedReason.length < 10 || sharedReason.length > 1000) return;
    // Freeze exactly the visible, explicitly selected references and their
    // reviewed versions. Each retains the existing transactional audit check.
    const batch = [...selectedRows];
    const conflicts = Array.from(new Set(batch.flatMap(row => row.issues.length ? row.issues : ["Draft attachment (no conflict flagged)"])));
    if (!window.confirm(`Discard ${batch.length} selected draft reference${batch.length === 1 ? "" : "s"}?\n\nSelected: ${batch.map(row => row.name).join(", ")}\nReview types: ${conflicts.join("; ")}\nShared reason: ${sharedReason}\n\nOnly these references will be removed from this draft. Original photos, provenance and submitted records stay unchanged. Each removal is audited separately.`)) return;
    busyRef.current = true; stopRef.current = false; setBusy(true); setError(null); setNotice(null); setResults([]);
    let completed = 0;
    try {
      for (const row of batch) {
        if (stopRef.current || jobRef.current !== jobId) break;
        try {
          const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/evidence-review`, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "DISCARD_DRAFT_REFERENCE", key: row.key, version: row.version, reason: sharedReason }) });
          const body = await response.json();
          if (jobRef.current !== jobId) return;
          if (!response.ok || body.ok !== true || body.key !== row.key || !(body.discardedReference === true || body.alreadyRemoved === true)) throw new Error(body.error || "Removal was not confirmed. Refresh before retrying.");
          ++completed;
          setReview(current => current && ({ ...current, rows: current.rows.map(item => item.key === row.key ? { ...item, removed: true } : item) }));
          setSelected(current => current.filter(key => key !== row.key));
          setResults(current => [...current, { key: row.key, name: row.name, text: body.alreadyRemoved ? "Already removed" : "Removed" }]);
        } catch (err) {
          if (jobRef.current !== jobId) return;
          const text = err instanceof Error ? err.message : "Removal was not confirmed. Refresh before retrying.";
          setResults(current => [...current, { key: row.key, name: row.name, text }]);
          setError(`${completed} of ${batch.length} confirmed. Stopped at ${row.name}: ${text} Remaining references were not processed.`);
          // Do not silently continue after stale state, revoked access or an
          // uncertain outcome. Successful items are deselected; retain the rest.
          return;
        }
      }
      if (jobRef.current !== jobId) return;
      setNotice(`${completed} of ${batch.length} references removed. ${completed < batch.length ? "Stopped; remaining references were not processed." : "The cleaner should refresh the job."}`);
      if (completed === batch.length) await load();
    } finally { busyRef.current = false; setBusy(false); }
  }

  return <ECard id="draft-evidence-review" className="font-sans text-[0.8125rem] leading-5">
    <button type="button" aria-expanded={expanded} aria-controls={panelId} disabled={busy} className="flex min-h-14 w-full items-center gap-2 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2" onClick={() => { setExpanded(value => !value); clearSelection(); }}>
      <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Draft evidence review</span><span className="block text-xs text-[hsl(var(--e-text-secondary))]">{loading ? "Loading…" : error && !review ? "Could not load · expand to retry" : `${review?.rows.filter(row => !row.removed).length ?? 0} active · ${review?.rows.filter(row => !row.removed && row.issues.length).length ?? 0} need review`}</span></span>
      <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
    {expanded ? <div id={panelId} className="space-y-3 border-t border-[hsl(var(--e-border))] p-3 sm:p-4">
      <p className="text-[hsl(var(--e-text-secondary))]">Discard draft references only. Originals and submitted evidence stay unchanged.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 items-center gap-2">Show<select aria-label="Evidence filter" className="min-h-11 rounded border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]" value={filter} disabled={busy || loading} onChange={event => { setFilter(event.target.value); setPage(0); clearSelection(); }}><option value="active">Active references</option><option value="issues">Needs review</option><option value="removed">Removed references</option></select></label>
        <EButton type="button" size="sm" variant="ghost" className="min-h-11" disabled={loading || busy} onClick={() => void load()}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Refresh</EButton>
      </div>
      {loading ? <p role="status">Loading draft evidence…</p> : null}
      {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {review?.comparisonWarning ? <p role="status">{review.comparisonWarning}</p> : null}
      {review?.locked ? <p>Submitted or finished job: review is read-only.</p> : null}
      {eligible.length ? <div className="flex flex-wrap items-center justify-between gap-1">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2"><input type="checkbox" aria-label={`Select all on this page (${eligible.length})`} className="h-4 w-4" checked={eligible.every(row => selected.includes(row.key))} disabled={busy || loading} onChange={event => setSelected(event.target.checked ? eligible.map(row => row.key) : [])} />Select this page ({eligible.length})</label>
        <span role="status">{selectedRows.length} selected</span>
      </div> : null}
      <div aria-label="Draft references" className="max-h-[22rem] overflow-y-auto rounded border border-[hsl(var(--e-border))]">
        {visible.map(row => <article key={row.key} className="flex min-w-0 items-start border-b border-[hsl(var(--e-border))] last:border-b-0">
          {!row.removed && !review?.locked ? <label className="flex h-14 w-11 shrink-0 cursor-pointer items-center justify-center"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.key)} disabled={busy || loading} className="h-4 w-4" onChange={event => setSelected(current => event.target.checked ? [...current, row.key] : current.filter(key => key !== row.key))} /></label> : null}
          <details className="min-w-0 flex-1 px-2">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{row.name}</span><span className="block truncate text-xs text-[hsl(var(--e-text-secondary))]">{row.removed ? "Removed from draft" : row.issues[0] ?? row.locations.map(locationLabel).join(" · ")}{row.issues.length > 1 && !row.removed ? ` · +${row.issues.length - 1} more` : ""}</span></span><span className="shrink-0 text-xs underline">Details</span>
            </summary>
            <div className="space-y-2 pb-3 [overflow-wrap:anywhere]">
              {row.previewUrl ? <MediaGallery items={[{ id: row.key, url: row.previewUrl, label: row.name }]} title={`Preview ${row.name}`} className="grid max-w-32 grid-cols-1" /> : null}
              <EBadge tone={row.removed ? "neutral" : row.issues.length ? "warning" : "info"}>{row.removed ? "Removed" : row.issues.length ? "Needs review" : "Draft attachment"}</EBadge>
              {row.issues.length ? <ul className="list-inside list-disc">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}
              <p>{row.locations.map(locationLabel).join(" · ")}</p>
              <dl className="space-y-1"><dt className="font-medium">Original storage key</dt><dd>{row.key}</dd><dt className="font-medium">Source job</dt><dd>{row.source?.jobId ? <a href={`/v2/admin/jobs/${encodeURIComponent(row.source.jobId)}?tab=forms`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 underline">{row.source.jobId}<ExternalLink aria-hidden="true" className="h-3 w-3" /></a> : "Not recorded in legacy key"}</dd><dt className="font-medium">Recorded uploader / capture</dt><dd>{row.source?.userId ?? "Unknown"} / {row.source?.captureId ?? "Not recorded"}</dd></dl>
              <p>Capture time is not available from this receipt. Original photo stamps are unchanged.</p>
              {row.receipts.map(receipt => <div key={receipt.id} className="space-y-1 border-t border-[hsl(var(--e-border))] pt-2"><p>Receipt: {receipt.id}</p><p>Current binding form: {receipt.formRevision}</p>{receipt.captureContext ? <p>Original capture form: {receipt.captureContext.formRevision} · Original account context: {receipt.captureContext.draftIdentity}</p> : null}<p>Account context: {receipt.draftIdentity}</p>{receipt.resolution ? <p>Discarded {new Date(receipt.resolution.at).toLocaleString()}: {receipt.resolution.reason}</p> : null}</div>)}
            </div>
          </details>
        </article>)}
        {!visible.length && !loading ? <p className="p-3">No references in this view.</p> : null}
      </div>
      {pageCount > 1 ? <div className="flex items-center justify-between gap-2"><EButton type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy || loading || currentPage === 0} onClick={() => { setPage(currentPage - 1); clearSelection(); }}>Previous</EButton><span>Page {currentPage + 1} of {pageCount}</span><EButton type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy || loading || currentPage + 1 === pageCount} onClick={() => { setPage(currentPage + 1); clearSelection(); }}>Next</EButton></div> : null}
      {selectedRows.length ? <div className="space-y-2 rounded border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))] p-3">
        <label className="block font-medium">Shared reason for {selectedRows.length} selected<ETextarea rows={2} value={reason} maxLength={1000} disabled={busy} className="mt-1 min-h-16 w-full text-base sm:text-sm" placeholder="Explain why these references should be discarded (10–1000 characters)." onChange={event => setReason(event.target.value)} /></label>
        <p className="text-xs">Review each selected item. The same reason is recorded separately for each removal.</p>
        <div className="flex flex-wrap gap-2"><EButton type="button" size="sm" variant="outline" className="min-h-11 h-auto whitespace-normal text-[hsl(var(--e-danger))]" disabled={loading || busy || reason.trim().length < 10} onClick={() => void discardSelected()}><Trash2 aria-hidden="true" className="h-4 w-4" />{busy ? "Processing…" : `Discard ${selectedRows.length} selected`}</EButton>
          {busy ? <EButton type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => { stopRef.current = true; setNotice("Stopping after the current request. Confirmed removals are retained."); }}>Stop after current</EButton> : <EButton type="button" size="sm" variant="ghost" className="min-h-11" onClick={clearSelection}>Clear selection</EButton>}
        </div>
      </div> : null}
      {results.length ? <details open={Boolean(error)}><summary className="min-h-11 cursor-pointer py-3">Batch results ({results.length})</summary><ul className="max-h-40 space-y-1 overflow-auto">{results.map(result => <li key={result.key} className="break-words">{result.name}: {result.text}</li>)}</ul></details> : null}
      {review?.history.length ? <details><summary className="min-h-11 cursor-pointer py-3">Resolution history (latest 50)</summary><ol className="max-h-48 space-y-2 overflow-auto">{review.history.map(item => <li key={item.id} className="border-b border-[hsl(var(--e-border))] pb-2"><p>{item.user.name ?? "Office user"} · {new Date(item.createdAt).toLocaleString()}</p><p>{item.action === "OFFICE_DISCARD_DRAFT_REFERENCE" ? "Office draft-reference override" : "Cleaner discarded a wrong reference"}</p><p className="break-words">{item.after?.reason}</p></li>)}</ol></details> : null}
    </div> : null}
  </ECard>;
}
