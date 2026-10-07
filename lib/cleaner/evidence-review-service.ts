import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { discardDraftReference, draftEvidenceEntry } from "./evidence-review";
import { saveSharedCleanerJobDraft, type SharedCleanerJobDraftRecord } from "./shared-job-draft";

export function evidenceEntryVersion(draft: SharedCleanerJobDraftRecord | null, key: string) {
  return createHash("sha256").update(JSON.stringify(draftEvidenceEntry(draft, key))).digest("hex");
}
/** Caller holds the shared draft and job locks; audit failure rolls back removal. */
export async function saveDraftReferenceDiscard(tx: Prisma.TransactionClient, jobId: string, draft: SharedCleanerJobDraftRecord | null,
  input: { key: string; actorId: string; actorName: string; effectiveUserId: string; reason: string; formRevision: string; draftIdentity: string; office: boolean }) {
  const before = draftEvidenceEntry(draft, input.key);
  if (!before.locations.length && before.receipts.length && before.receipts.every(([, receipt]) => receipt.detached)) return;
  const next = discardDraftReference(draft, { ...input, at: new Date().toISOString(), receiptId: randomUUID() });
  await saveSharedCleanerJobDraft(jobId, next, tx);
  await tx.auditLog.create({ data: { userId: input.actorId, jobId, entity: "CleanerDraftEvidence", entityId: jobId,
    action: input.office ? "OFFICE_DISCARD_DRAFT_REFERENCE" : "CLEANER_DISCARD_DRAFT_REFERENCE",
    before: before as unknown as Prisma.InputJsonValue,
    after: { key: input.key, reason: input.reason, effectiveUserId: input.effectiveUserId, operation: "DISCARD_DRAFT_REFERENCE", originalRetained: true, submittedRecordsUnchanged: true } } });
}
