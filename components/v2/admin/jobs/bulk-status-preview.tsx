"use client";
import { useEffect, useRef, useState } from "react";
import { bulkStatusPreviewSchema, type BulkStatusPreview } from "@/lib/jobs/bulk-status";
import { statusLabel } from "./job-row";

type Props = { jobIds: string[]; status: string; context: string; onApplied: () => void; onBusy: (busy: boolean) => void };
export function BulkStatusPreviewControls(props: Props) {
  return <ScopedPreview key={JSON.stringify([props.context, props.status, [...props.jobIds].sort()])} {...props} />;
}
function ScopedPreview({ jobIds, status, context, onApplied, onBusy }: Props) {
  const [preview, setPreview] = useState<BulkStatusPreview | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const alive = useRef(true); const lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function review() {
    if (lock.current || uncertain) return;
    lock.current = true; setLoading(true); setPreview(null); setMessage("");
    try {
      const params = new URLSearchParams({ jobIds: JSON.stringify(jobIds), status });
      const response = await fetch(`/api/admin/jobs/bulk-status/preview?${params}`, { cache: "no-store", headers: { "x-jobs-view-context": context } });
      if (!response.ok) throw new Error("Could not load the preview. Refresh the selection and try again.");
      const data = bulkStatusPreviewSchema.parse(await response.json());
      if (data.context !== context || data.status !== status || JSON.stringify(data.rows.map(row => row.id).sort()) !== JSON.stringify(Array.from(new Set(jobIds)).sort())) throw new Error("The preview does not match this selection.");
      if (alive.current) setPreview(data);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : "Could not load preview."); }
    finally { lock.current = false; if (alive.current) setLoading(false); }
  }
  async function apply() {
    if (lock.current || !preview || uncertain || preview.rows.some(row => row.blocked)) return;
    lock.current = true; setSaving(true); setMessage(""); onBusy(true);
    try {
      const response = await fetch("/api/admin/jobs/bulk-status", { method: "POST", headers: { "Content-Type": "application/json", "x-jobs-view-context": context }, body: JSON.stringify({ jobIds, status, reviewToken: preview.reviewToken }) });
      const result = await response.json().catch(() => null);
      if (!alive.current) return;
      if (!response.ok && [400, 401, 403, 404, 409].includes(response.status)) { setPreview(null); setMessage(result?.error ?? "The batch was not applied. Refresh the preview."); return; }
      if (!response.ok || result?.ok !== true || result.updated !== preview.rows.length || result.status !== status) throw new Error();
      onApplied();
    } catch { if (alive.current) { setUncertain(true); setMessage("The outcome is unknown. Close this dialog and refresh jobs to verify the result before starting another batch. This request will not be retried."); } }
    finally { lock.current = false; if (alive.current) setSaving(false); onBusy(false); }
  }
  return <div className="space-y-3">
    <p className="text-sm">Review every selected job before applying. The whole batch succeeds together or no jobs change.</p>
    {message ? <p role="alert" className="text-sm">{message}</p> : null}
    <button type="button" className="min-h-11 rounded border px-3" disabled={loading || saving || uncertain} onClick={() => void review()}>{loading ? "Loading preview…" : preview ? "Refresh preview" : "Review changes"}</button>
    {preview ? <>
      <ul className="max-h-72 space-y-3 overflow-y-auto" aria-label="Changes to review">{preview.rows.map(row => <li key={row.id} className="rounded border p-3 text-sm">
        <p className="font-semibold">{row.label}</p><p>{statusLabel(row.before)} → {statusLabel(row.after)}</p>
        {row.consequences.map(text => <p key={text}>{text}</p>)}
      </li>)}</ul>
      {preview.rows.some(row => row.blocked) ? <p role="alert">An invoiced job blocks this batch. Change the selection and review again.</p> : null}
      <button type="button" className="min-h-11 rounded border px-3" disabled={saving || loading || uncertain || preview.rows.some(row => row.blocked)} onClick={() => void apply()}>{saving ? "Applying reviewed changes…" : `Apply reviewed changes (${preview.rows.length})`}</button>
    </> : null}
  </div>;
}
