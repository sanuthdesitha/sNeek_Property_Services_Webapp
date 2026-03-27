import { db } from "@/lib/db";

const CLEANER_SHARED_DRAFT_PREFIX = "cleaner_job_shared_draft_v1:";

export type SharedCleanerJobDraftRecord = {
  updatedAt: string;
  updatedByUserId: string;
  updatedByName: string;
  editorSessionId: string;
  state: Record<string, unknown>;
};

function sharedCleanerDraftKey(jobId: string) {
  return `${CLEANER_SHARED_DRAFT_PREFIX}${jobId}`;
}

export async function getSharedCleanerJobDraft(jobId: string): Promise<SharedCleanerJobDraftRecord | null> {
  const row = await db.appSetting.findUnique({
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
    updatedAt: value.updatedAt,
    updatedByUserId: value.updatedByUserId,
    updatedByName: value.updatedByName,
    editorSessionId: value.editorSessionId,
    state: value.state as Record<string, unknown>,
  };
}

export async function saveSharedCleanerJobDraft(jobId: string, draft: SharedCleanerJobDraftRecord) {
  await db.appSetting.upsert({
    where: { key: sharedCleanerDraftKey(jobId) },
    create: {
      key: sharedCleanerDraftKey(jobId),
      value: draft as any,
    },
    update: {
      value: draft as any,
    },
  });
}

export async function clearSharedCleanerJobDraft(jobId: string) {
  await db.appSetting.deleteMany({
    where: { key: sharedCleanerDraftKey(jobId) },
  });
}
