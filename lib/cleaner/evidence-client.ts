import { getEvidence, putEvidence, sameEvidenceScope, type EvidenceRecord, type EvidenceScope, type EvidenceReceipt } from "./evidence-store";
import { destinationOf, destinationKey, type EvidenceDestination } from "./evidence-destination";
// Keep a known remote receipt available in this tab even if device storage
// temporarily fails after upload. Across a restart, uploading/no receipt is
// explicitly uncertain and must never automatically send the blob again.
const receiptMemory = new Map<string, EvidenceRecord>();
export async function removeEvidence(scope: EvidenceScope, key: string) {
  if (!navigator.locks?.request) throw new Error("This browser cannot safely coordinate evidence recovery.");
  const id = key.split("/")[2] ?? key;
  await navigator.locks.request(`cleaner-evidence:${id}`, async () => {
    const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/evidence`, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": scope.draftIdentity }, body: JSON.stringify({ key, formRevision: scope.formRevision }) });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error(body.error || "Removal was not confirmed.");
    const record = await getEvidence(id);
    if (record && sameEvidenceScope(record, scope)) await putEvidence({ ...record, status: "detached" });
  });
}

export async function moveEvidence(scope: EvidenceScope, media: EvidenceReceipt, from: EvidenceDestination, to: EvidenceDestination) {
  const headers = { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": scope.draftIdentity };
  const read = await fetch(`/api/cleaner/jobs/${encodeURIComponent(scope.jobId)}/draft`, { headers, cache: "no-store" });
  const draft = await read.json();
  if (!read.ok) throw new Error(draft.error || "Evidence could not be checked.");
  const entry = Object.entries(draft.draft?.evidenceReceipts ?? {}).find(([, value]) => (value as any).key === media.key) as [string, any] | undefined;
  if (!entry) return; // Existing legacy uploaded media remains list-managed.
  const [id, receipt] = entry;
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
      body: JSON.stringify({ captureId: id, fieldId: to.type === "formField" ? to.fieldId : destinationKey(to), destination: to,
        templateId: scope.templateId, formRevision: scope.formRevision, key: media.key, name: media.name ?? "Evidence", move: { from, version: receipt.version ?? 0 } }) });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || "Evidence move was not confirmed. Retry after reloading.");
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
}
