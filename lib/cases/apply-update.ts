/**
 * One case update as the office makes it: the rules PATCH /api/admin/cases/[id]
 * has always applied, shared with the bulk endpoint so a bulk change can never
 * skip one of them.
 *
 * - A status change needs a note (the existing required status-change note).
 * - The status change is recorded as an internal comment with that note.
 * - The existing update notification runs (client only when the case is visible).
 */
import { db } from "@/lib/db";
import { getCaseById, updateCase } from "@/lib/cases/service";
import { notifyCaseUpdated } from "@/lib/cases/notifications";

export type CasePatchInput = Parameters<typeof updateCase>[1];

export type CaseUpdateActor = { id: string; name?: string | null; email?: string | null };

export type CaseUpdateResult =
  | { ok: true; case: NonNullable<Awaited<ReturnType<typeof getCaseById>>> }
  | { ok: false; status: 400 | 404; error: string };

export const STATUS_NOTE_REQUIRED = "A note is required when changing case status.";

export async function applyCaseUpdate(input: {
  caseId: string;
  patch: CasePatchInput;
  statusChangeNote?: string | null;
  actor: CaseUpdateActor;
}): Promise<CaseUpdateResult> {
  const { caseId, patch, actor } = input;
  const note = input.statusChangeNote?.trim() || null;
  const before = await getCaseById(caseId);
  if (!before) return { ok: false, status: 404, error: "Case not found." };

  const statusChanged = Boolean(patch.status && patch.status !== before.status);
  if (statusChanged && !note) return { ok: false, status: 400, error: STATUS_NOTE_REQUIRED };

  const updated = await updateCase(caseId, patch, { actorId: actor.id, statusChangeNote: note });
  if (!updated) return { ok: false, status: 404, error: "Case not found." };

  if (statusChanged) {
    const fromLabel = before.status.replace(/_/g, " ");
    const toLabel = updated.status.replace(/_/g, " ");
    await db.caseComment.create({
      data: {
        caseId: updated.id,
        authorUserId: actor.id,
        isInternal: true,
        body: `Status changed from ${fromLabel} to ${toLabel}.\n\n${note}`,
      },
    });
  }

  await notifyCaseUpdated({
    caseItem: updated,
    actorLabel: actor.name || actor.email || "Admin",
    updateNote: statusChanged
      ? `Status updated to ${updated.status.replace(/_/g, " ")}${note ? `: ${note}` : ""}`
      : patch.status
        ? `Status reviewed as ${updated.status.replace(/_/g, " ")}`
        : "Case details updated",
    notifyClient: patch.clientVisible === true || updated.clientVisible === true,
  });

  // Re-read so the status comment written above is part of the returned case.
  const fresh = statusChanged ? await getCaseById(caseId) : updated;
  return { ok: true, case: fresh ?? updated };
}
