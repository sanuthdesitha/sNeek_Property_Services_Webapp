import { getEvidence, listEvidence, putEvidence, sameEvidenceScope, type EvidenceRecord, type EvidenceScope, type EvidenceReceipt } from "./evidence-store";
import { destinationOf, destinationKey, destinationMedia, setDestinationMedia, evidenceDestinationSchema, isLegacyEvidenceKey, type EvidenceDestination } from "./evidence-destination";
// Keep a known remote receipt available in this tab even if device storage
// temporarily fails after upload. Across a restart, uploading/no receipt is
// explicitly uncertain and must never automatically send the blob again.
const receiptMemory = new Map<string, EvidenceRecord>();
/** Cancel a capture without deleting its retained original or remote object. */
export async function cancelPendingEvidence(record: EvidenceRecord, scope: EvidenceScope) {
  if (!sameEvidenceScope(record, scope)) throw new Error("Evidence context changed. Reload before removing this capture.");
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence recovery.");
  return await navigator.locks.request(`cleaner-evidence:${record.id}`, async () => {
    const current = await getEvidence(record.id);
    if (!current || !sameEvidenceScope(current, scope)) throw new Error("Evidence recovery context changed. Keep the original.");
    const key = current.receipt?.key ?? current.allocation?.key;
    const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/evidence`, {
      method: "DELETE", headers: { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": scope.draftIdentity },
      body: JSON.stringify({ cancelPending: true, captureId: current.id, templateId: scope.templateId, formRevision: scope.formRevision, ...(key ? { key } : {}) }),
    });
    const body = await response.json();
    if (!response.ok || body.ok !== true || body.captureId !== current.id || body.detached !== true) throw new Error(body.error || "Capture removal was not confirmed. Keep the original and retry.");
    await putEvidence({ ...current, status: "detached", error: undefined });
    receiptMemory.delete(current.id);
    return key;
  });
}
export async function removeEvidence(scope: EvidenceScope, key: string, discardReason?: string) {
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence recovery.");
  const id = key.split("/")[2] ?? key;
  await navigator.locks.request(`cleaner-evidence:${id}`, async () => {
    const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/evidence`, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": scope.draftIdentity }, body: JSON.stringify({ key, formRevision: scope.formRevision, ...(discardReason ? { discardReference: true, reason: discardReason } : {}) }) });
    const body = await response.json();
    if (!response.ok || body.ok !== true || body.key !== key || (discardReason && body.discardedReference !== true)) {
      throw Object.assign(new Error(body.error || "Removal was not confirmed."), { key, canDiscardReference: body.code === "EVIDENCE_CONTEXT_MISMATCH" && body.canDiscardReference === true });
    }
    const record = await getEvidence(id);
    if (record && sameEvidenceScope(record, scope)) await putEvidence({ ...record, status: "detached" });
  });
}

export async function moveEvidence(scope: EvidenceScope, media: EvidenceReceipt, from: EvidenceDestination, to: EvidenceDestination, expected?: { captureId: string; version: number }) {
  const headers = { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": scope.draftIdentity };
  const read = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/draft`, { headers, cache: "no-store" });
  const draft = await read.json();
  if (!read.ok) throw new Error(draft.error || "Evidence could not be checked.");
  const entry = Object.entries(draft.draft?.evidenceReceipts ?? {}).find(([, value]) => (value as any).key === media.key) as [string, any] | undefined;
  if (!entry) {
    if (expected) throw new Error("Evidence receipt changed. Refresh suggestions before assigning.");
    return; // Existing legacy uploaded media remains list-managed.
  }
  const [id, receipt] = entry;
  if (expected && (id !== expected.captureId || (receipt.version ?? 0) !== expected.version || destinationKey(destinationOf(receipt)) !== destinationKey(from))) throw new Error("Evidence receipt changed. Refresh suggestions before assigning.");
  const alreadyMoved = destinationKey(destinationOf(receipt)) === destinationKey(to);
  if (receipt.detached || receipt.draftIdentity !== scope.draftIdentity || receipt.formRevision !== scope.formRevision || (!alreadyMoved && destinationKey(destinationOf(receipt)) !== destinationKey(from))) throw new Error("Evidence changed or belongs to another cleaner. Reload before moving it.");
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence recovery.");
  await navigator.locks.request(`cleaner-evidence:${id}`, async () => {
    if (alreadyMoved) {
      const current = await getEvidence(id);
      if (current && sameEvidenceScope(current, scope)) await putEvidence({ ...current, destination: to, fieldId: to.type === "formField" ? to.fieldId : destinationKey(to), destinationVersion: receipt.version ?? 0 });
      return;
    }
    const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/evidence`, { method: "POST", headers,
      body: JSON.stringify({ captureId: id, ...(isLegacyEvidenceKey(media.key) ? { legacy: true } : {}), fieldId: to.type === "formField" ? to.fieldId : destinationKey(to), destination: to,
        templateId: scope.templateId, formRevision: scope.formRevision, key: media.key, name: media.name ?? "Evidence", move: { from, version: receipt.version ?? 0 } }) });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Evidence move was not confirmed. Retry after reloading.");
    if (expected && (body.captureId !== id || body.key !== media.key || body.version !== expected.version + 1 || !body.destination || destinationKey(body.destination) !== destinationKey(to))) throw new Error("Evidence move acknowledgement did not match. Reload evidence before assigning again.");
    const record = await getEvidence(id);
    if (record && sameEvidenceScope(record, scope)) await putEvidence({ ...record, destination: to, fieldId: to.type === "formField" ? to.fieldId : destinationKey(to), destinationVersion: body.version });
  });
}

export async function attachEvidence(record: EvidenceRecord): Promise<EvidenceReceipt> {
  const expectedKey = record.receipt?.key ?? record.allocation?.key;
  if (!expectedKey) throw new Error("Upload receipt is missing.");
  const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(record.jobId)}/evidence`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": record.draftIdentity },
    body: JSON.stringify({ captureId: record.id, fieldId: record.fieldId, destination: record.destination, templateId: record.templateId,
      formRevision: record.formRevision, key: expectedKey, name: record.filename }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "Evidence attachment was not confirmed. Retry from device recovery.");
  if (body?.ok !== true || body.captureId !== record.id || body.key !== expectedKey) {
    throw new Error("Evidence attachment could not be confirmed. Retry from device recovery.");
  }
  const media = body.media;
  if (media !== undefined) {
    if (media?.key !== expectedKey || !["image", "video", "file"].includes(media?.kind) || typeof media?.url !== "string" ||
      !(media.url.startsWith("/") && !media.url.startsWith("//") || /^https?:\/\//i.test(media.url))) {
      throw new Error("Evidence recovery returned an invalid receipt. Keep the original and retry.");
    }
    return { key: media.key, url: media.url, kind: media.kind, name: record.filename };
  }
  if (record.receipt) return record.receipt;
  throw new Error("Evidence recovery did not return its verified media receipt. Keep the original and retry.");
}

// A known receipt is always attached again, never uploaded again. The Web Lock
// serializes processing of one capture across tabs sharing this browser profile.
export async function processEvidence(record: EvidenceRecord, scope: EvidenceScope,
  upload: (record: EvidenceRecord, beforeNetwork: () => Promise<void>) => Promise<EvidenceReceipt>): Promise<EvidenceReceipt> {
  if (!sameEvidenceScope(record, scope)) throw new Error("This evidence belongs to an older form. Keep it for office review.");
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence recovery. Keep the original file and use a supported browser.");
  return navigator.locks.request(evidenceJobLockName(scope), { mode: "shared", ifAvailable: true }, lock => {
    if (!lock) throw new Error("This job is being submitted. Keep the original and wait for submission to finish.");
    return navigator.locks.request(`cleaner-evidence:${record.id}`, async () => {
    let current = await getEvidence(record.id);
    if (!current || !sameEvidenceScope(current, scope)) throw new Error("Evidence recovery context changed. Reload this job.");
    if (destinationKey(destinationOf(current)) !== destinationKey(destinationOf(record))) throw new Error("This evidence moved to another destination. Reload device recovery before retrying.");
    const retained = receiptMemory.get(record.id);
    if (retained && sameEvidenceScope(retained, scope) && retained.receipt && current.status !== "detached") current = retained;
    if (current.status === "detached") throw new Error("This evidence was explicitly removed. Keep the original for review.");
    if (current.status === "attached" && current.receipt) return current.receipt;
    if (current.status === "uploading" && !current.receipt && !current.allocation) {
      throw new Error("The previous upload outcome is uncertain. Save the original and ask the office to review it; the file will not be uploaded again automatically.");
    }
    try {
      let attachmentConfirmed = false;
      if (current.status === "uploading" && !current.receipt && current.allocation) {
        // The original allocation is authoritative. The endpoint verifies this
        // exact owned object with HEAD and attaches it; it never lists a bucket,
        // allocates another key, or asks the browser to resend original bytes.
        const receipt = await attachEvidence(current);
        current = { ...current, receipt, status: "uploaded", error: undefined };
        receiptMemory.set(current.id, current);
        await putEvidence(current);
        attachmentConfirmed = true;
      }
      if (!current.receipt) {
        current = { ...current, status: "preparing", error: undefined };
        await putEvidence(current);
        const receipt = await upload(current, async () => {
          current = { ...(await getEvidence(current!.id) ?? current!), status: "uploading" };
          await putEvidence(current);
        });
        const uploaded = await getEvidence(current.id) ?? current;
        if (uploaded.allocation && uploaded.allocation.key !== receipt.key) {
          throw new Error("The upload receipt did not match its allocated key. Retry exact-key recovery; do not upload this file again.");
        }
        current = { ...uploaded, receipt, status: "uploaded" };
        receiptMemory.set(current.id, current);
        // Keep receipt in memory if this write fails; never proceed to an
        // attachment that recovery cannot subsequently identify.
        await putEvidence(current);
      }
      // A recovered in-memory receipt also needs durable storage before ACK.
      await putEvidence(current);
      if (!attachmentConfirmed) current = { ...current, receipt: await attachEvidence(current) };
      const terminal = await getEvidence(current.id);
      if (terminal?.status === "detached") {
        receiptMemory.delete(current.id);
        throw new Error("This evidence was removed while its acknowledgement was pending. Reload to review the current attachments.");
      }
      current = { ...current, status: "attached", error: undefined };
      await putEvidence(current);
      receiptMemory.delete(current.id);
      return current.receipt!;
    } catch (error) {
      const latest = await getEvidence(current.id).catch(() => undefined);
      if (latest?.status === "detached" || !current.receipt) current = latest ?? current;
      current = { ...current, error: error instanceof Error ? error.message : "Evidence could not be saved." };
      await putEvidence(current).catch(() => {});
      throw error;
    }
  });
  });
}

/** Repair a lost device ACK only from the authorized server receipt and its saved media. */
async function reconcileEvidence(scope: EvidenceScope, nonblocking: boolean, onServerDraft?: (draft: any) => void): Promise<{ records: EvidenceRecord[]; reconciled: EvidenceRecord[]; activeCaptureIds: string[] }> {
  // Nonblocking checks run behind the job gate: read once, only after a capture
  // lock is available. Blocking recovery must refresh after each potential wait.
  let draftPromise: ReturnType<typeof readServerEvidenceDraft> | undefined;
  const fetchDraft = () => readServerEvidenceDraft(scope).then(draft => { onServerDraft?.(draft); return draft; });
  const readDraft = () => nonblocking ? (draftPromise ??= fetchDraft()) : fetchDraft();
  let records: EvidenceRecord[];
  try { records = await listEvidence(); }
  catch (error) {
    if (!nonblocking) throw error;
    // Device backup availability is not a required form field. The caller holds
    // the job submission lock, and the server still verifies the final ledger.
    await readDraft();
    return { records: [], reconciled: [], activeCaptureIds: [] };
  }
  const pending = records.filter(record => sameEvidenceScope(record, scope) && record.status !== "detached");
  if (!pending.length) return { records, reconciled: [], activeCaptureIds: [] };
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence recovery.");
  const reconciled: EvidenceRecord[] = [];
  const activeCaptureIds: string[] = [];
  for (const record of pending) {
    const reconcile = async () => {
    let current: EvidenceRecord | undefined;
    try { current = await getEvidence(record.id); }
    catch (error) { if (!nonblocking) throw error; await readDraft(); return; }
    if (!current || !sameEvidenceScope(current, scope) || current.status === "detached") return;
    const draft = await readDraft();
    const saved = draft?.evidenceReceipts?.[current.id];
    if (!saved || saved.draftIdentity !== scope.draftIdentity || saved.formRevision !== scope.formRevision || typeof saved.key !== "string" || typeof saved.fieldId !== "string") return;
    const version = saved.version ?? 0;
    if (!Number.isInteger(version) || version < (current.destinationVersion ?? 0)) return;
    const expectedKey = current.receipt?.key ?? current.allocation?.key;
    if (!expectedKey || saved.key !== expectedKey) return;
    const destination = evidenceDestinationSchema.safeParse(saved.destination ?? { type: "formField", fieldId: saved.fieldId });
    if (!destination.success) return;
    if (saved.detached === true) {
      const updated: EvidenceRecord = { ...current, status: "detached", error: undefined };
      await putEvidence(updated); reconciled.push(updated); receiptMemory.delete(current.id); return;
    }
    if (saved.detached !== undefined && saved.detached !== false) return;
    const media = destinationMedia(draft.state ?? {}, destination.data).find(item => item?.key === saved.key);
    if (!media || typeof media.url !== "string" || !["image", "video", "file"].includes(media.kind)) return;
    const updated: EvidenceRecord = { ...current, status: "attached", fieldId: saved.fieldId, destination: destination.data, destinationVersion: version,
      receipt: { key: media.key, url: media.url, kind: media.kind, name: typeof media.name === "string" ? media.name : current.filename }, error: undefined };
    if (current.status !== "attached" || JSON.stringify(current.receipt) !== JSON.stringify(updated.receipt) || destinationKey(destinationOf(current)) !== destinationKey(destination.data) || current.destinationVersion !== version) await putEvidence(updated);
    reconciled.push(updated);
    receiptMemory.delete(current.id);
    };
    if (nonblocking) await navigator.locks.request(`cleaner-evidence:${record.id}`, { ifAvailable: true }, async lock => {
      if (!lock) { activeCaptureIds.push(record.id); return; }
      await reconcile();
    });
    else await navigator.locks.request(`cleaner-evidence:${record.id}`, reconcile);
  }
  let latest = records;
  try { latest = await listEvidence(); } catch (error) { if (!nonblocking) throw error; }
  return { records: latest, reconciled, activeCaptureIds };
}
export async function reconcileEvidenceAcknowledgements(scope: EvidenceScope): Promise<EvidenceRecord[]> {
  return (await reconcileEvidenceAcknowledgementsWithChanges(scope)).records;
}

/** Project only records confirmed by this server reconciliation, never all cached attachments. */
type EvidenceProjection = EvidenceScope & Pick<EvidenceRecord, "id" | "fieldId" | "status" | "destination" | "receipt" | "allocation">;
export function projectReconciledEvidence(state: Record<string, any>, reconciled: EvidenceProjection[], scope: EvidenceScope): { state: Record<string, any>; changed: boolean } {
  let next = state;
  for (const record of reconciled) {
    if (!sameEvidenceScope(record, scope) || !["attached", "detached"].includes(record.status)) continue;
    const key = record.receipt?.key ?? record.allocation?.key;
    if (!key) continue;
    const destinations: EvidenceDestination[] = [
      ...Object.keys(next.uploads ?? {}).map(fieldId => ({type: "formField" as const, fieldId})),
      ...Object.keys(next.taskDrafts ?? {}).map(taskId => ({type: "jobTask" as const, taskId})),
      {type: "bulkPool"}, {type: "laundry"}, {type: "carryForwardNew"},
    ];
    const target = destinationOf(record);
    let retained = false;
    for (const destination of destinations) {
      const current = destinationMedia(next, destination);
      if (!current.some(media => media?.key === key)) continue;
      const belongsHere = record.status === "attached" && record.receipt && destinationKey(destination) === destinationKey(target);
      const replacement = current.flatMap(media => {
        if (media?.key !== key) return [media];
        if (!belongsHere || retained) return [];
        retained = true;
        // Keep capture metadata and the original photo ordering. A receipt's
        // optional display name must not erase device-specific metadata.
        const verified = record.receipt!;
        return [media.kind === verified.kind && media.url === verified.url ? media : { ...media, ...verified }];
      });
      if (replacement.length !== current.length || replacement.some((media, index) => media !== current[index])) next = setDestinationMedia(next, destination, replacement);
    }
    if (record.status === "attached" && record.receipt && !retained) next = setDestinationMedia(next, target, [...destinationMedia(next, target), record.receipt]);
  }
  return { state: next, changed: next !== state };
}
function evidenceJobLockName(scope: EvidenceScope) { return `cleaner-evidence-job:${scope.draftIdentity}:${scope.jobId}`; }
/** Hold upload admission closed until the submission callback settles. */
export async function withEvidenceSubmissionLock<T>(scope: EvidenceScope, callback: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence submission. Reload in a supported browser.");
  return navigator.locks.request(evidenceJobLockName(scope), { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("An upload is still running. Wait for it to finish, then submit again.");
    return callback();
  });
}
/** Failed or abandoned records are retained; only a live capture lock blocks. */
export async function checkSubmissionEvidence(scope: EvidenceScope) {
  let serverDraft: any; let serverChecked = false;
  const result = await reconcileEvidence(scope, true, draft => { serverDraft = draft; serverChecked = true; });
  if (result.activeCaptureIds.length) return result;
  // The authorized job draft owns acknowledged attachments, not this device's
  // IndexedDB journal. A lost journal or stale autosave must not strand a photo
  // behind EVIDENCE_CHANGED forever. Reuse the fresh read taken under a capture
  // lock when available; otherwise the caller still holds the job submit lock.
  if (!serverChecked) serverDraft = await readServerEvidenceDraft(scope);
  const reconciled = new Map<string, EvidenceProjection>(result.reconciled.map(record => [record.id, record]));
  const detachedLocally = new Set(result.records.filter(record => sameEvidenceScope(record, scope) && record.status === "detached").map(record => record.id));
  for (const [id, raw] of Object.entries(serverDraft?.evidenceReceipts ?? {})) {
    const saved = raw as any;
    if (!saved || typeof saved.key !== "string" || typeof saved.fieldId !== "string" || detachedLocally.has(id)) continue;
    const destination = evidenceDestinationSchema.safeParse(saved.destination ?? { type: "formField", fieldId: saved.fieldId });
    if (!destination.success) continue;
    if (saved.detached === true) {
      reconciled.set(id, { ...scope, id, fieldId: saved.fieldId, destination: destination.data, status: "detached", allocation: { key: saved.key, uploadId: "server-confirmed-removal" } });
      continue;
    }
    if (saved.detached !== undefined && saved.detached !== false) continue;
    const media = destinationMedia(serverDraft.state ?? {}, destination.data).find(item => item?.key === saved.key);
    if (!media || !["image", "video", "file"].includes(media.kind) || typeof media.url !== "string" ||
      !(media.url.startsWith("/") && !media.url.startsWith("//") || /^https?:\/\//i.test(media.url))) continue;
    // Projection only: do not fabricate a local capture/blob or change authorship.
    reconciled.set(id, { ...scope, id, fieldId: saved.fieldId, destination: destination.data, status: "attached", receipt: { key: media.key, url: media.url, kind: media.kind, name: media.name } });
  }
  return { ...result, reconciled: Array.from(reconciled.values()) };
}
export async function reconcileEvidenceAcknowledgementsWithChanges(scope: EvidenceScope): Promise<{ records: EvidenceRecord[]; reconciled: EvidenceRecord[] }> {
  const {records,reconciled} = await reconcileEvidence(scope, false); return {records,reconciled};
}
async function readServerEvidenceDraft(scope: EvidenceScope) {
  const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/draft`, { headers: { "X-Cleaner-Draft-Identity": scope.draftIdentity }, cache: "no-store" });
  const body = await response.json();
  if (!response.ok || !body || typeof body !== "object" || !("draft" in body)) throw new Error(body?.error || "Saved evidence could not be checked. Retry when connected.");
  return body.draft;
}