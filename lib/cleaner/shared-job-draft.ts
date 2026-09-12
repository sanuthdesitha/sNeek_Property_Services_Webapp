import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

const CLEANER_SHARED_DRAFT_PREFIX = "cleaner_job_shared_draft_v1:";

export type SharedCleanerJobDraftRecord = {
  /** Server-owned idempotent attachment receipts; generic autosave cannot write these. */
  evidenceReceipts?: Record<string, { key: string; fieldId: string; formRevision: string; draftIdentity: string; detached?: boolean }>;
  updatedAt: string;
  updatedByUserId: string;
  updatedByName: string;
  editorSessionId: string;
  state: Record<string, unknown>;
};

function sharedCleanerDraftKey(jobId: string) {
  return `${CLEANER_SHARED_DRAFT_PREFIX}${jobId}`;
}

// All draft mutations, including submit cleanup, share this transaction lock.
// Callers with an existing transaction must use READ COMMITTED visibility.
export async function withSharedCleanerJobDraftLock<T>(
  jobId: string,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  tx?: Prisma.TransactionClient
): Promise<T> {
  const run = async (client: Prisma.TransactionClient) => {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sharedCleanerDraftKey(jobId)}))`;
    return mutate(client);
  };
  return tx ? run(tx) : db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function getSharedCleanerJobDraft(jobId: string, tx?: Prisma.TransactionClient): Promise<SharedCleanerJobDraftRecord | null> {
  const row = await (tx ?? db).appSetting.findUnique({
    where: { key: sharedCleanerDraftKey(jobId) },
    select: { value: true },
  });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return null;
  }
  const value = row.value as Record<string, unknown>;
  if (
    typeof value.updatedAt !== "string" ||
    typeof value.updatedByUserId !== "string" ||
    typeof value.updatedByName !== "string" ||
    typeof value.editorSessionId !== "string" ||
    !value.state ||
    typeof value.state !== "object" ||
    Array.isArray(value.state)
  ) {
    return null;
  }
  return {
    ...(value.evidenceReceipts && typeof value.evidenceReceipts === "object" && !Array.isArray(value.evidenceReceipts)
      ? { evidenceReceipts: value.evidenceReceipts as SharedCleanerJobDraftRecord["evidenceReceipts"] } : {}),
    updatedAt: value.updatedAt,
    updatedByUserId: value.updatedByUserId,
    updatedByName: value.updatedByName,
    editorSessionId: value.editorSessionId,
    state: value.state as Record<string, unknown>,
  };
}

export async function saveSharedCleanerJobDraft(jobId: string, draft: SharedCleanerJobDraftRecord, tx?: Prisma.TransactionClient) {
  await withSharedCleanerJobDraftLock(jobId, async (client) => {
    await client.appSetting.upsert({
      where: { key: sharedCleanerDraftKey(jobId) },
      create: {
        key: sharedCleanerDraftKey(jobId),
        value: draft as any,
      },
      update: {
        value: draft as any,
      },
    });
  }, tx);
}

export async function clearSharedCleanerJobDraft(jobId: string, tx?: Prisma.TransactionClient) {
  await withSharedCleanerJobDraftLock(jobId, async (client) => {
    const existing = await getSharedCleanerJobDraft(jobId, client);
    if (existing?.evidenceReceipts && Object.keys(existing.evidenceReceipts).length > 0) {
      // Clearing answers is not an explicit detach. Keep immutable receipt
      // history and acknowledged media; only the evidence endpoint changes it.
      const previous = (existing.state.uploads ?? {}) as Record<string, any[]>;
      const uploads: Record<string, unknown[]> = {};
      for (const receipt of Object.values(existing.evidenceReceipts)) {
        if (!receipt.detached) uploads[receipt.fieldId] = (previous[receipt.fieldId] ?? [])
          .filter(media => Object.values(existing.evidenceReceipts!).some(value => !value.detached && value.fieldId === receipt.fieldId && value.key === media?.key));
      }
      const updatedAt = new Date().toISOString();
      await client.appSetting.upsert({ where: { key: sharedCleanerDraftKey(jobId) },
        create: { key: sharedCleanerDraftKey(jobId), value: { ...existing, updatedAt, state: { updatedAt, uploads } } as any },
        update: { value: { ...existing, updatedAt, state: { updatedAt, uploads } } as any } });
      return;
    }
    await client.appSetting.deleteMany({
      where: { key: sharedCleanerDraftKey(jobId) },
    });
  }, tx);
}
