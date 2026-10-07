import { destinationKey, destinationMedia, destinationOf, removeEvidenceKeys, type EvidenceDestination } from "./evidence-destination";
import type { SharedCleanerJobDraftRecord } from "./shared-job-draft";

/** Storage layout is provenance, never permission to adopt or relabel evidence. */
export function evidenceProvenance(key: string) {
  const parts = key.split("/");
  if (key.length > 1000 || /[\\\u0000-\u0020\u007f]/.test(key) || parts.some(part => !part || part === "." || part === "..")) return null;
  if (parts[0] === "forms" && parts.length === 5) return { jobId: parts[1], captureId: parts[2], userId: parts[3], legacy: false };
  if (parts[0] === "jobs" && parts.length === 4) return { jobId: parts[1], captureId: null, userId: parts[2], legacy: true };
  if (parts[0] === "forms" && parts.length === 3) return { jobId: null, captureId: null, userId: parts[1], legacy: true };
  return null;
}
export function belongsToAnotherJob(key: string, jobId: string) {
  const source = evidenceProvenance(key);
  return Boolean(source?.jobId && source.jobId !== jobId);
}
export function draftEvidenceLocations(state: Record<string, any>) {
  const destinations: EvidenceDestination[] = [
    { type: "bulkPool" }, ...Object.keys(state.uploads ?? {}).map(fieldId => ({ type: "formField" as const, fieldId })),
    ...Object.keys(state.taskDrafts ?? {}).map(taskId => ({ type: "jobTask" as const, taskId })),
    { type: "laundry" }, { type: "carryForwardNew" },
  ];
  return destinations.flatMap(destination => destinationMedia(state, destination).flatMap(media =>
    media && typeof media.key === "string" ? [{ destination, media }] : []));
}
export function draftEvidenceEntry(draft: SharedCleanerJobDraftRecord | null, key: string) {
  return {
    key,
    locations: draftEvidenceLocations(draft?.state ?? {}).filter(item => item.media.key === key),
    receipts: Object.entries(draft?.evidenceReceipts ?? {}).filter(([, receipt]) => receipt.key === key),
  };
}
export function canCleanerDiscardReference(draft: SharedCleanerJobDraftRecord | null, key: string, jobId: string, userId: string) {
  const source = evidenceProvenance(key);
  const entry = draftEvidenceEntry(draft, key);
  // Never let an unassigned-pool action remove filed evidence or another
  // cleaner's valid same-job attachment. Office must review those conflicts.
  if (entry.locations.some(item => item.destination.type !== "bulkPool") || entry.receipts.some(([, receipt]) => !receipt.detached && destinationOf(receipt).type !== "bulkPool")) return false;
  return Boolean(source && (belongsToAnotherJob(key, jobId) || (source.userId === userId && entry.locations.some(item => item.destination.type === "bulkPool"))));
}
export function discardDraftReference(draft: SharedCleanerJobDraftRecord | null, input: { key: string; actorId: string; actorName: string; reason: string; at: string; receiptId: string; formRevision: string; draftIdentity: string; office: boolean }) {
  const entry = draftEvidenceEntry(draft, input.key);
  const resolution = { action: "DISCARD_DRAFT_REFERENCE" as const, actorId: input.actorId, reason: input.reason, at: input.at, office: input.office };
  const receipts = { ...draft?.evidenceReceipts };
  if (entry.receipts.length) {
    for (const [id, receipt] of entry.receipts) receipts[id] = { ...receipt, detached: true, resolution };
  } else {
    // This is a removal marker, not an upload/capture acknowledgement. No
    // capture timestamp, source identity, or historical proof is invented.
    receipts[input.receiptId] = { key: input.key, fieldId: "bulkPool", destination: { type: "bulkPool" }, formRevision: input.formRevision, draftIdentity: input.draftIdentity, detached: true, resolution };
  }
  return { ...draft, evidenceReceipts: receipts, updatedAt: input.at, updatedByUserId: input.actorId,
    updatedByName: input.actorName, editorSessionId: draft?.editorSessionId ?? `discard:${input.receiptId}`,
    state: removeEvidenceKeys(draft?.state ?? {}, new Set([input.key])) };
}
export function evidenceReviewRows(draft: SharedCleanerJobDraftRecord | null, jobId: string) {
  const keys = new Set([...draftEvidenceLocations(draft?.state ?? {}).map(item => item.media.key), ...Object.values(draft?.evidenceReceipts ?? {}).map(receipt => receipt.key)]);
  return Array.from(keys).map(key => {
    const entry = draftEvidenceEntry(draft, key);
    const source = evidenceProvenance(key);
    const issues: string[] = [];
    if (belongsToAnotherJob(key, jobId)) issues.push("Stored under another job");
    if (!source) issues.push("Unrecognised storage provenance");
    if (source?.legacy && !source.jobId) issues.push("Legacy upload: original job is not encoded");
    if (!entry.receipts.length) issues.push("No capture receipt");
    if (entry.receipts.some(([, receipt]) => !receipt.detached && !entry.locations.some(item => destinationKey(item.destination) === destinationKey(destinationOf(receipt))))) issues.push("Receipt and draft location differ");
    if (entry.receipts.some(([, receipt]) => receipt.detached) && entry.locations.length) issues.push("Removed reference restored by stale draft");
    return { ...entry, source, issues, removed: entry.receipts.length > 0 && entry.receipts.every(([, receipt]) => receipt.detached), name: entry.locations[0]?.media.name || "Draft photo" };
  });
}
