import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  clearSharedCleanerJobDraft,
  getSharedCleanerJobDraft,
  saveSharedCleanerJobDraft,
  withSharedCleanerJobDraftLock,
} from "@/lib/cleaner/shared-job-draft";
import { mergeDraftStates, unionMedia } from "@/lib/cleaner/draft-merge";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";

const draftSchema = z.object({
  editorSessionId: z.string().trim().min(1).max(120),
  state: z.record(z.unknown()),
});

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
}
function identityMismatch(req: NextRequest, session: Parameters<typeof cleanerDraftIdentity>[0], jobId: string) {
  const supplied = req.headers.get("X-Cleaner-Draft-Identity");
  return supplied !== null && supplied !== cleanerDraftIdentity(session, jobId);
}
function accountChanged() {
  return json({ error: "Account changed. Reload this job." }, 409);
}
function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return json({ error: message }, 401);
  if (message === "FORBIDDEN") return json({ error: message }, 403);
  if (err instanceof z.ZodError || err instanceof SyntaxError) {
    return json({ error: "Invalid draft request" }, 400);
  }
  return json({ error: "Unable to process job draft" }, 500);
}

async function assertCleanerAssignment(jobId: string, userId: string, tx: Prisma.TransactionClient = db) {
  const assignment = await tx.jobAssignment.findFirst({
    where: {
      jobId,
      userId,
      removedAt: null,
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

async function isJobLocked(jobId: string, tx: Prisma.TransactionClient = db) {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) return true;
  const lockedStatuses: JobStatus[] = [
    JobStatus.SUBMITTED,
    JobStatus.QA_REVIEW,
    JobStatus.COMPLETED,
    JobStatus.INVOICED,
  ];
  return lockedStatuses.includes(job.status);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (identityMismatch(req, session, params.id)) return accountChanged();
    const isAssigned = await assertCleanerAssignment(params.id, session.user.id);
    if (!isAssigned) {
      return json({ error: "Not assigned to this job" }, 403);
    }
    const draft = await getSharedCleanerJobDraft(params.id);
    return json({ draft });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = draftSchema.parse(await req.json());
    return await withSharedCleanerJobDraftLock(params.id, async (tx) => {
      if (identityMismatch(req, session, params.id)) return accountChanged();
      const isAssigned = await assertCleanerAssignment(params.id, session.user.id, tx);
      if (!isAssigned) {
        return json({ error: "Not assigned to this job" }, 403);
      }
      if (await isJobLocked(params.id, tx)) {
        return json({ error: "Job is already finished" }, 409);
      }
      const updatedAt = new Date().toISOString();

      // Cross-editor saves merge under the lock; same-editor saves replace so
      // intentional removals from that editor still take effect.
      const existing = await getSharedCleanerJobDraft(params.id, tx);
      const incoming = body.state as Record<string, unknown>;
      const mergedState =
        existing?.state && existing.editorSessionId !== body.editorSessionId
          ? mergeDraftStates(existing.state, incoming)
          : incoming;
      // Generic autosave is not an explicit evidence detach operation. Preserve
      // acknowledged attachments when a stale same-editor snapshot arrives.
      if (existing?.evidenceReceipts) {
        const previous = (existing.state.uploads ?? {}) as Record<string, unknown>;
        const next = { ...((mergedState.uploads ?? {}) as Record<string, unknown>) };
        const boundKeys = new Set(Object.values(existing.evidenceReceipts).map(receipt => receipt.key));
        const stripBound = (media: unknown) => Array.isArray(media) ? media.filter(item => !boundKeys.has(item?.key)) : [];
        mergedState.bulkPool = stripBound(mergedState.bulkPool);
        if (mergedState.taskDrafts && typeof mergedState.taskDrafts === "object") mergedState.taskDrafts = Object.fromEntries(
          Object.entries(mergedState.taskDrafts).map(([id, task]) => [id, { ...(task as object), proof: stripBound((task as any)?.proof) }]));
        for (const [group, key] of [["laundry", "photo"], ["carryForward", "photos"]]) {
          if (mergedState[group] && typeof mergedState[group] === "object") mergedState[group] = { ...(mergedState[group] as object), [key]: stripBound((mergedState[group] as any)[key]) };
        }
        for (const receipt of Object.values(existing.evidenceReceipts)) {
          for (const [fieldId, media] of Object.entries(next)) {
            if ((receipt.detached || fieldId !== receipt.fieldId) && Array.isArray(media)) next[fieldId] = media.filter(item => item?.key !== receipt.key);
          }
          if (receipt.detached) {
            if (Array.isArray(next[receipt.fieldId])) next[receipt.fieldId] = (next[receipt.fieldId] as any[]).filter(media => media?.key !== receipt.key);
            continue;
          }
          const retained = Array.isArray(previous[receipt.fieldId])
            ? (previous[receipt.fieldId] as any[]).filter(media => media?.key === receipt.key) : [];
          next[receipt.fieldId] = unionMedia(next[receipt.fieldId], retained);
        }
        mergedState.uploads = next;
      }

      await saveSharedCleanerJobDraft(params.id, {
        ...(existing?.evidenceReceipts ? { evidenceReceipts: existing.evidenceReceipts } : {}),
        updatedAt,
        updatedByUserId: session.user.id,
        updatedByName: session.user.name ?? session.user.email ?? "Cleaner",
        editorSessionId: body.editorSessionId,
        state: mergedState,
      }, tx);
      return json({ ok: true, updatedAt });
    });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);
    return await withSharedCleanerJobDraftLock(params.id, async (tx) => {
      if (identityMismatch(req, session, params.id)) return accountChanged();
      const isAssigned = await assertCleanerAssignment(params.id, session.user.id, tx);
      if (!isAssigned) {
        return json({ error: "Not assigned to this job" }, 403);
      }
      await clearSharedCleanerJobDraft(params.id, tx);
      return json({ ok: true });
    });
  } catch (err: unknown) {
    return errorResponse(err);
  }
}
