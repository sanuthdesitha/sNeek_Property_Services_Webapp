/**
 * Bulk case actions, one case at a time through the single-case service.
 *
 * - assign: the owner must be an active office user (the same list the owner
 *   picker shows); null clears the owner.
 * - status / close: a note is required, exactly as for one case. Close sets the
 *   existing CLOSED status.
 * Each row returns done (with the case's new summary) or refused with a reason.
 */
import { listCaseAssignees } from "@/lib/cases/service";
import { applyCaseUpdate, STATUS_NOTE_REQUIRED, type CaseUpdateActor } from "@/lib/cases/apply-update";
import { getCaseSummary, type CaseSummary } from "@/lib/cases/summaries";
import type { UnifiedCaseStatus } from "@/lib/cases/status";

export type CaseBulkAction =
  | { action: "assign"; ids: string[]; assignedToUserId: string | null }
  | { action: "status"; ids: string[]; status: UnifiedCaseStatus; note: string }
  | { action: "close"; ids: string[]; note: string };

export type CaseBulkOutcome =
  | { id: string; outcome: "done"; case: CaseSummary | null }
  | { id: string; outcome: "refused"; reason: string };

export async function runCaseBulk(input: CaseBulkAction, actor: CaseUpdateActor): Promise<CaseBulkOutcome[]> {
  const ids = Array.from(new Set(input.ids));
  if (input.action === "assign" && input.assignedToUserId) {
    const assignees = await listCaseAssignees();
    if (!assignees.some((person) => person.id === input.assignedToUserId)) {
      return ids.map((id) => ({ id, outcome: "refused", reason: "That owner is not an active office user." }));
    }
  }
  if (input.action !== "assign" && !input.note.trim()) {
    return ids.map((id) => ({ id, outcome: "refused", reason: STATUS_NOTE_REQUIRED }));
  }

  const results: CaseBulkOutcome[] = [];
  for (const id of ids) {
    try {
      const result =
        input.action === "assign"
          ? await applyCaseUpdate({ caseId: id, patch: { assignedToUserId: input.assignedToUserId }, actor })
          : await applyCaseUpdate({
              caseId: id,
              patch: { status: input.action === "close" ? "CLOSED" : input.status },
              statusChangeNote: input.note,
              actor,
            });
      if (!result.ok) {
        results.push({ id, outcome: "refused", reason: result.error });
        continue;
      }
      results.push({ id, outcome: "done", case: await getCaseSummary(id) });
    } catch (error) {
      results.push({ id, outcome: "refused", reason: error instanceof Error ? error.message : "Could not update this case." });
    }
  }
  return results;
}
