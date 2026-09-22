"use client";
import * as React from "react";
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
  return <section aria-label="Device evidence recovery" className="rounded border p-3 space-y-2">
    <h2 className="font-semibold">Evidence saved on this device</h2>
    <p className="text-sm">Remove a failed upload to stop recovery and unblock submission. Its original stays here until you clear the device copy.</p>
    {error ? <p role="alert">{error}</p> : null}
    {volatile.map(record => <div key={record.id} className="flex flex-wrap gap-2 items-center text-sm">
      <span>{record.filename} — Not saved on this device. Keep this page open.</span>
      <button type="button" onClick={() => download(record)}>Save original</button>
      {!locked && sameEvidenceScope(record, scope) ? <button type="button" disabled={Boolean(busy)} onClick={() => {
        setBusy(record.id);
        void putEvidence(record).then(() => { releaseVolatileEvidence(record.id); return retry(record); }).catch(() => {
          setError("Device storage is still unavailable. Save the original before leaving."); setBusy(null);
        });
      }}>Retry saving and attaching</button> : null}
      {exported.includes(record.id) ? <button type="button" onClick={() => releaseVolatileEvidence(record.id)}>I saved the original; remove from this page</button> : null}
    </div>)}
    {records.map(record => <div key={record.id} className="flex flex-wrap gap-2 items-center text-sm">
      <span>{record.filename} — {record.status === "detached" ? "Removed from job" : record.status === "attached" ? "Attached to job" : !sameEvidenceScope(record, scope) ? "Older form — keep for review" : record.receipt ? "Verifying attachment" : record.status === "preparing" ? "Preparing file; original saved" : record.status === "uploading" ? "Upload started; verification pending" : "Queued on this device"}</span>
      <button type="button" onClick={() => download(record)}>Save original</button>
      {!["attached", "detached"].includes(record.status) && sameEvidenceScope(record, scope) && !locked ? <button type="button" disabled={Boolean(busy)} onClick={() => void retry(record)}>{busy === record.id ? "Recovering…" : "Retry attachment"}</button> : null}
      {!["attached", "detached"].includes(record.status) && sameEvidenceScope(record, scope) && !locked ? <button type="button" disabled={Boolean(busy)} onClick={() => {
        setBusy(record.id); setError("");
        void cancelPendingEvidence(record, scope).then(key => {
          if (key) onRemoved?.(key);
        }).catch(error => setError(error instanceof Error ? error.message : "Removal failed. Keep the original and retry."))
          .finally(() => setBusy(null));
      }}>Remove failed upload; keep original</button> : null}
      {record.status === "attached" && record.receipt && sameEvidenceScope(record, scope) && !locked ? <button type="button" disabled={Boolean(busy)} onClick={() => {
        setBusy(record.id);
        void removeEvidence(scope, record.receipt!.key).then(() => onRemoved?.(record.receipt!.key))
          .catch(error => setError(error instanceof Error ? error.message : "Removal failed.")).finally(() => setBusy(null));
      }}>Remove attachment; keep original</button> : null}
      {["attached", "detached"].includes(record.status) ? <button type="button" disabled={Boolean(busy)} onClick={() => void clearAttachedEvidence(record).catch(() => setError("Could not clear the device copy."))}>Clear device copy</button> : null}
    </div>)}
  </section>;
}
