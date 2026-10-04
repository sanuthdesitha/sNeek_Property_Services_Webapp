"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Plan = {
  revision: number;
  baseline: null | { jobId: string; completedDay: string; dueDay: string; verifiedAt: string; reviewNote: string };
  proposal: null | { id: string; status: string; dueDay: string; jobId: string | null; scheduledDay: string | null };
};
type View = { plan: Plan; baselineValid: boolean; today: string; canManage: boolean; candidates: Array<{ id: string; jobNumber: string; completedAt: string; hasProof: boolean }> };
export function PropertyDeepCleanPlanning({ propertyId }: { propertyId: string }) {
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const url = `/api/admin/properties/${propertyId}/deep-clean-planning`;
  useEffect(() => {
    let active = true;
    setData(null); setError(null);
    fetch(url, { cache: "no-store" }).then(async res => { const body = await res.json(); if (!res.ok) throw new Error(body.error ?? "Could not load planning."); return body; })
      .then(body => { if (active) setData(body); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [url, reload]);
  useEffect(() => { setJobId(""); setReviewNote(""); setReviewed(false); setDate(""); setMessage(null); }, [propertyId]);
  async function save(action: "verify" | "schedule") {
    if (!data) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const payload = action === "verify" ? { action, revision: data.plan.revision, jobId, reviewNote, evidenceReviewed: reviewed }
        : { action, revision: data.plan.revision, proposalId: data.plan.proposal?.id, date };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error ?? "Could not save planning.");
      setMessage(action === "verify" ? "Baseline verified. Any due proposal remains undated until you schedule it." : "Dated draft created. Review scope and pricing in the job before publishing.");
      setReviewed(false); setDate(""); setReload(n => n + 1);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save planning."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Deep-clean planning">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Deep-clean planning</h3><Link className="underline text-sm" href="/v2/admin/deep-clean-planning">Owner scheduling queue</Link></div>
    <p className="text-sm">Three Sydney calendar months after a verified deep clean, create an undated office proposal. The owner chooses the date. Proposals do not assign cleaners, dispatch work, notify clients or create charges.</p>
    {error && <div role="alert">{error} <button type="button" className="underline" disabled={busy} onClick={() => setReload(n => n + 1)}>Reload planning</button></div>}
    {message && <p role="status">{message}</p>}
    {!data ? !error && <p>Loading deep-clean planning…</p> : <>
      {!data.plan.baseline ? <p>No verified completion baseline. The next due date is unknown.</p> : <div>
        <p>Verified completion: <Link className="underline" href={`/admin/jobs/${data.plan.baseline.jobId}`}>{data.plan.baseline.completedDay}</Link>. Next due: {data.plan.baseline.dueDay}.</p>
        {!data.baselineValid && <p role="alert">Completion or evidence changed. Re-verify before scheduling.</p>}
      </div>}
      {data.plan.proposal?.status === "NEEDS_SCHEDULING" && <div className="space-y-2 rounded border p-3">
        <p className="font-medium">Unscheduled — owner to choose date</p><p>Deep clean due {data.plan.proposal.dueDay}. No service date has been assigned.</p>
        {data.canManage && <><label className="block">Service date<input className="ml-2 rounded border p-1" type="date" min={data.today} value={date} onChange={event => setDate(event.target.value)} /></label>
          <button className="rounded border px-3 py-2" disabled={busy || !date || !data.baselineValid} onClick={() => void save("schedule")}>Create dated draft</button></>}
      </div>}
      {data.plan.proposal?.status === "DEFERRED" && <p>Proposal deferred until {data.plan.proposal.dueDay}. No service date has been assigned.</p>}
      {data.plan.proposal?.status === "SCHEDULED" && <p>Dated draft: <Link className="underline" href={`/admin/jobs/${data.plan.proposal.jobId}`}>{data.plan.proposal.scheduledDay}</Link>. Scheduling this proposal again cannot create another job.</p>}
      {data.canManage ? <details className="space-y-2"><summary className="cursor-pointer">Review and verify a completed deep clean</summary>
        <p className="text-sm">Open the job and review the deep-clean coverage and submitted photos/video. A job label or a matching photo alone is not verification. An authoritative QA failure blocks verification.</p>
        <label className="block">Completed deep-clean job<select className="ml-2 rounded border p-1" value={jobId} onChange={event => { setJobId(event.target.value); setReviewed(false); }}><option value="">Choose a completed job</option>{data.candidates.map(job => <option key={job.id} value={job.id} disabled={!job.hasProof}>{job.jobNumber}{job.hasProof ? "" : " — missing submitted proof"}</option>)}</select></label>
        {jobId && <Link className="block underline" href={`/admin/jobs/${jobId}`} target="_blank" rel="noreferrer">Open job evidence for review</Link>}
        <p className="text-xs">Latest 50 completed deep-clean jobs shown. Missing history stays unverified.</p>
        <label className="block">Verification note<textarea className="block w-full rounded border p-2" maxLength={2000} value={reviewNote} onChange={event => setReviewNote(event.target.value)} /></label>
        <label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the evidence and confirm this was a completed deep clean.</label>
        <button className="rounded border px-3 py-2" disabled={busy || !jobId || !reviewNote.trim() || !reviewed} onClick={() => void save("verify")}>Verify completion baseline</button>
      </details> : <p className="text-sm">An administrator must verify the baseline and choose the service date.</p>}
    </>}
  </section>;
}
export function DeepCleanProposalQueue() {
  const [rows, setRows] = useState<Array<{ propertyId: string; propertyName: string; baselineValid: boolean; proposal: { id: string; dueDay: string } }>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  async function load(after?: string) {
    setLoading(true); setError(null);
    try { const res = await fetch(`/api/admin/deep-clean-proposals${after ? `?cursor=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" }); const body = await res.json(); if (!res.ok) throw new Error(body.error ?? "Could not load proposals."); setRows(previous => after ? [...previous, ...body.proposals] : body.proposals); setCursor(body.nextCursor); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load proposals."); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Deep cleans awaiting owner scheduling</h1><p>These office proposals have no service date. Choose a property to review and create a dated draft.</p>
    <button className="rounded border px-3 py-1" disabled={loading} onClick={() => void load()}>Refresh queue</button>
    {error && <p role="alert">{error}</p>}{loading && <p>Loading proposals…</p>}
    {!loading && !error && !rows.length && <p>No undated proposals in this page of verified properties. Unverified properties have no inferred due date.</p>}
    <ul>{rows.map(row => <li className="flex gap-3 border-b py-2" key={row.proposal.id}><button className="underline" onClick={() => setSelected(row.propertyId)}>{row.propertyName}</button><span>Due {row.proposal.dueDay} — {row.baselineValid ? "Unscheduled" : "Evidence needs re-verification"}</span></li>)}</ul>
    {cursor && <button disabled={loading} className="rounded border px-3 py-1" onClick={() => void load(cursor)}>Load more properties</button>}
    {selected && <PropertyDeepCleanPlanning key={selected} propertyId={selected} />}
  </div>;
}
