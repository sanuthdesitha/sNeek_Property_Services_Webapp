import "server-only";
/**
 * The cleaner's answer on a lost and found handover task (2026-11-20), called
 * by the JobTask service inside the job submission's transaction.
 *
 * - Completed (with the photo the task requires, or the truthful missing-photo
 *   reason the JobTask service already insists on): the request becomes
 *   COMPLETED and the item RETURNED through the transition table. The photo
 *   stays on the task (JobTaskAttachment) and its keys are kept on the
 *   timeline entry as the handover evidence.
 * - Not completed / not applicable: the request stays approved but needs a new
 *   arrangement; the office is told. The task is not carried forward.
 *
 * Kept free of the JobTask service import so that service can call it.
 */
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { statusChangeData } from "./mutations";

export const LOST_FOUND_RETURN_TASK_KIND = "LOST_FOUND_RETURN";

type Tx = Prisma.TransactionClient;

export type ReturnTaskDecision = {
  taskId: string;
  decision: "COMPLETED" | "NOT_COMPLETED" | "NOT_APPLICABLE";
  cleanerId: string;
  note: string | null;
  proofKeys: string[];
  missingPhotoReason: string | null;
};

export async function applyLostFoundReturnTaskDecision(tx: Tx, input: ReturnTaskDecision, afterCommit?: Array<() => Promise<unknown>>): Promise<void> {
  const request = await tx.lostFoundReturnRequest.findUnique({ where: { jobTaskId: input.taskId } });
  if (!request || request.status !== "APPROVED") return;
  await tx.$queryRaw`SELECT "id" FROM "LostFoundItem" WHERE "id" = ${request.itemId} FOR UPDATE`;
  const item = await tx.lostFoundItem.findUnique({ where: { id: request.itemId } });
  if (!item) return;
  const now = new Date();
  const cleaner = await tx.user.findUnique({ where: { id: input.cleanerId }, select: { name: true, email: true } });
  const cleanerName = cleaner?.name?.trim() || cleaner?.email || "The cleaner";

  if (input.decision === "COMPLETED") {
    await tx.lostFoundReturnRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", version: { increment: 1 }, completedAt: now, completedById: input.cleanerId, completionNote: input.note, attentionReason: null, attentionAt: null },
    });
    const evidence = input.proofKeys.length ? `Handover photo${input.proofKeys.length === 1 ? "" : "s"} kept on the task (${input.proofKeys.length}).` : `No photo: ${input.missingPhotoReason ?? "reason not given"}.`;
    let statusNote = "";
    try {
      const change = statusChangeData(item, { status: "RETURNED", resolution: `Handed over by ${cleanerName} on the clean (task).` }, input.cleanerId, now);
      if (change.kind !== "same") {
        await tx.lostFoundItem.update({ where: { id: item.id }, data: change.data });
      }
    } catch {
      statusNote = " The item's status was not changed (it is closed); check it.";
    }
    await tx.lostFoundEvent.create({
      data: {
        itemId: item.id,
        userId: input.cleanerId,
        action: "RETURNED",
        note: `Handed over to the guest by ${cleanerName} as arranged. ${evidence}${input.note ? ` Cleaner's note: ${input.note}` : ""}${statusNote}`,
        meta: { requestId: request.id, jobTaskId: input.taskId, proofKeys: input.proofKeys, missingPhotoReason: input.missingPhotoReason, fromStatus: item.status, toStatus: statusNote ? item.status : "RETURNED", byCleaner: true } as Prisma.InputJsonValue,
      },
    });
    const notify = async () => {
      const { notifyOfficeOfReturn } = await import("./return-notices");
      await notifyOfficeOfReturn({ itemId: item.id, requestId: request.id, eventSuffix: input.taskId, part: "returned", actorId: input.cleanerId, actorName: cleanerName });
    };
    if (afterCommit) afterCommit.push(notify);
    else await notify().catch((err) => logger.error({ err }, "lost and found: returned notice failed"));
    return;
  }

  await tx.lostFoundReturnRequest.update({ where: { id: request.id }, data: { attentionReason: "task_not_done", attentionAt: now } });
  await tx.lostFoundEvent.create({
    data: {
      itemId: item.id,
      userId: input.cleanerId,
      action: "RETURN_NEEDS_REARRANGING",
      note: `${cleanerName} could not complete the handover${input.note ? `: ${input.note}` : ""}. Arrange a new time with the guest.`,
      meta: { requestId: request.id, jobTaskId: input.taskId, reason: "task_not_done", proofKeys: input.proofKeys } as Prisma.InputJsonValue,
    },
  });
  const notify = async () => {
    const { notifyOfficeOfReturn } = await import("./return-notices");
    await notifyOfficeOfReturn({ itemId: item.id, requestId: request.id, eventSuffix: `task-not-done:${input.taskId}`, part: "needs-rearranging", actorId: input.cleanerId, actorName: cleanerName, reason: `${cleanerName} could not complete the handover. Arrange a new time with the guest.` });
  };
  if (afterCommit) afterCommit.push(notify);
  else await notify().catch((err) => logger.error({ err }, "lost and found: rearrange notice failed"));
}
