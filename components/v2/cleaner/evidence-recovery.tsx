"use client";
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { clearAttachedEvidence, getEvidence, listEvidence, putEvidence, sameEvidenceScope, type EvidenceRecord, type EvidenceScope } from "@/lib/cleaner/evidence-store";
import { getVolatileEvidence, getVolatileEvidenceRevision, subscribeVolatileEvidence, releaseVolatileEvidence } from "@/lib/cleaner/evidence-volatile";
import { destinationOf, type EvidenceDestination } from "@/lib/cleaner/evidence-destination";
import { cancelPendingEvidence, removeEvidence } from "@/lib/cleaner/evidence-client";
import { prepareAndUploadFiles, type CapturedMedia } from "./media-capture";

export function EvidenceRecovery({ scope, locked, onRecovered, onRemoved }: {
  scope: EvidenceScope; locked: boolean; onRecovered: (fieldId: string, media: CapturedMedia, destination?: EvidenceDestination) => void;
  onRemoved?: (key: string) => void;
}) {
  const [records, setRecords] = React.useState<EvidenceRecord[]>([]);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [exported, setExported] = React.useState<string[]>([]);
  React.useSyncExternalStore(subscribeVolatileEvidence, getVolatileEvidenceRevision, () => 0);
  const volatile = getVolatileEvidence(scope);
  React.useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const rows = await listEvidence();
        if (active) setRecords(rows.filter(row => row.draftIdentity === scope.draftIdentity && row.jobId === scope.jobId));
      } catch { if (active) setError("Device recovery storage is unavailable. Keep your original files."); }
    }
    void refresh(); window.addEventListener("cleaner-evidence-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("cleaner-evidence-changed", refresh); window.removeEventListener("focus", refresh); };
  }, [scope.draftIdentity, scope.jobId]);
  if (!records.length && !volatile.length && !error) return null;
  async function retry(record: EvidenceRecord) {
    setBusy(record.id); setError("");
    try {
      record = await getEvidence(record.id) ?? record;
      const result = await prepareAndUploadFiles([new File([record.blob], record.filename, { type: record.mime })], {
        folder: record.folder, source: record.source, stamp: record.stamp,
        evidence: { ...scope, fieldId: record.fieldId, destination: record.destination }, recoveryRecords: [record],
      });
      if (result.results[0]) {
        const latest = await getEvidence(record.id);
        if (!latest || latest.status !== "attached" || !sameEvidenceScope(latest, scope)) throw new Error("Evidence changed during recovery. Reload this job.");
        onRecovered(latest.fieldId, result.results[0], destinationOf(latest));
      }
      else setError(result.failed[0]?.reason ?? "Evidence could not be recovered.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Evidence could not be recovered."); }
    finally { setBusy(null); }
  }
  function download(record: EvidenceRecord) {
    const url = URL.createObjectURL(record.blob);
    const link = document.createElement("a"); link.href = url; link.download = record.filename;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExported(current => [...current, record.id]);
  }
  const pendingCount = volatile.length + records.filter(record => !["attached", "detached"].includes(record.status) && sameEvidenceScope(record, scope)).length;
  return <section aria-label="Device evidence recovery" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-sm">
    <details><summary className="min-h-11 cursor-pointer px-4 py-3 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--e-accent-portal))]">{pendingCount ? `${pendingCount} upload${pendingCount === 1 ? "" : "s"} to check` : "Saved file copies"}<span className="ml-2 text-xs font-normal text-[hsl(var(--e-muted-foreground))]">Retry or manage files</span></summary><div className="space-y-3 border-t border-[hsl(var(--e-border))] p-4">
    <h2 className="font-semibold">Upload recovery</h2>
    <p className="text-sm">Remove a failed upload to stop recovery and unblock submission. Its original stays here until you clear the device copy.</p>

    {volatile.map(record => <div key={record.id} className="flex flex-wrap gap-2 items-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-3 text-sm [&>span]:w-full [&>span]:break-words">
      <span>{record.filename} — Not saved on this device. Keep this page open.</span>
      <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" onClick={() => download(record)}>Save original</EButton>
      {!locked && sameEvidenceScope(record, scope) ? <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" disabled={Boolean(busy)} onClick={() => {
        setBusy(record.id);
        void putEvidence(record).then(() => { releaseVolatileEvidence(record.id); return retry(record); }).catch(() => {
          setError("Device storage is still unavailable. Save the original before leaving."); setBusy(null);
        });
      }}>Retry saving and attaching</EButton> : null}
      {exported.includes(record.id) ? <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" onClick={() => releaseVolatileEvidence(record.id)}>I saved the original; remove from this page</EButton> : null}
    </div>)}
    {records.map(record => <div key={record.id} className="flex flex-wrap gap-2 items-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-3 text-sm [&>span]:w-full [&>span]:break-words">
      <span>{record.filename} — {record.status === "detached" ? "Removed from job" : record.status === "attached" ? "Attached to job" : !sameEvidenceScope(record, scope) ? "Older form — keep for review" : record.receipt ? "Verifying attachment" : record.status === "preparing" ? "Preparing file; original saved" : record.status === "uploading" ? "Upload started; verification pending" : "Queued on this device"}</span>
      <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" onClick={() => download(record)}>Save original</EButton>
      {!["attached", "detached"].includes(record.status) && sameEvidenceScope(record, scope) && !locked ? <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" disabled={Boolean(busy)} onClick={() => void retry(record)}>{busy === record.id ? "Recovering…" : "Retry attachment"}</EButton> : null}
      {!["attached", "detached"].includes(record.status) && sameEvidenceScope(record, scope) && !locked ? <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" disabled={Boolean(busy)} onClick={() => {
        setBusy(record.id); setError("");
        void cancelPendingEvidence(record, scope).then(key => {
          if (key) onRemoved?.(key);
        }).catch(error => setError(error instanceof Error ? error.message : "Removal failed. Keep the original and retry."))
          .finally(() => setBusy(null));
      }}>Remove failed upload; keep original</EButton> : null}
      {record.status === "attached" && record.receipt && sameEvidenceScope(record, scope) && !locked ? <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" disabled={Boolean(busy)} onClick={() => {
        setBusy(record.id);
        void removeEvidence(scope, record.receipt!.key).then(() => onRemoved?.(record.receipt!.key))
          .catch(error => setError(error instanceof Error ? error.message : "Removal failed.")).finally(() => setBusy(null));
      }}>Remove attachment; keep original</EButton> : null}
      {["attached", "detached"].includes(record.status) ? <EButton type="button" variant="outline" size="sm" className="min-h-11 h-auto whitespace-normal text-left" disabled={Boolean(busy)} onClick={() => void clearAttachedEvidence(record).catch(() => setError("Could not clear the device copy."))}>Clear device copy</EButton> : null}
    </div>)}
    </div></details>
    {error ? <p role="alert" className="px-4 pb-3 text-[hsl(var(--e-danger))]">{error}</p> : null}
  </section>;
}
