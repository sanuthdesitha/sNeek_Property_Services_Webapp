/**
 * Bulk "Mark fixed" for the Quality hub. Each selected issue goes through the
 * same rectifyQaIssue transaction the single action uses, one at a time, and
 * reports its own outcome: done, unchanged (already recorded that way) or
 * refused with the reason. Only issues whose fix is still owed are changed; an
 * issue already fixed another way is refused rather than re-labelled, because
 * who fixed it decides who is paid.
 */
import { RectificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { rectifyQaIssue, type RectifyActor } from "./rectify";
import { isOpenRectification, type FixedRectificationStatus } from "./types";

const STATUS_WORDS: Record<string, string> = {
  FIXED_BY_QA: "fixed by QA",
  FIXED_BY_MANAGER: "fixed by a manager",
  FIXED_BY_OTHER_CLEANER: "fixed by another cleaner",
};

function statusWords(status: string): string {
  return STATUS_WORDS[status] ?? status.toLowerCase().replace(/_/g, " ");
}

export const BULK_FIX_MAX_IDS = 100;

export type BulkFixOutcome = "done" | "unchanged" | "refused";
export type BulkFixRowResult = { id: string; ok: boolean; outcome: BulkFixOutcome; reason?: string };
export type BulkFixResponse = {
  results: BulkFixRowResult[];
  summary: Record<BulkFixOutcome, number>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not update this issue.";
}

export async function bulkMarkFixed(params: {
  ids: string[];
  status: FixedRectificationStatus;
  actor: RectifyActor;
}): Promise<BulkFixResponse> {
  const ids = Array.from(new Set(params.ids));
  const [issues, settings] = await Promise.all([
    db.qaIssue.findMany({ where: { id: { in: ids } } }),
    getAppSettings(),
  ]);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const results: BulkFixRowResult[] = [];

  for (const id of ids) {
    const issue = byId.get(id);
    if (!issue) {
      results.push({ id, ok: false, outcome: "refused", reason: "Issue not found." });
      continue;
    }
    if (issue.rectificationStatus === params.status) {
      results.push({ id, ok: false, outcome: "unchanged", reason: `Already ${statusWords(params.status)}. Nothing changed.` });
      continue;
    }
    if (!isOpenRectification(issue.rectificationStatus)) {
      results.push({
        id,
        ok: false,
        outcome: "refused",
        reason: `Already ${statusWords(issue.rectificationStatus)}. Open the issue to change how it was fixed.`,
      });
      continue;
    }
    try {
      await rectifyQaIssue({
        issue,
        input: { status: params.status as RectificationStatus },
        actor: params.actor,
        settings,
      });
      results.push({ id, ok: true, outcome: "done" });
    } catch (error) {
      results.push({ id, ok: false, outcome: "refused", reason: errorMessage(error) });
    }
  }

  const summary: Record<BulkFixOutcome, number> = { done: 0, unchanged: 0, refused: 0 };
  for (const row of results) summary[row.outcome] += 1;

  await db.auditLog
    .create({
      data: {
        userId: params.actor.id,
        action: "QA_ISSUE_BULK_RECTIFY",
        entity: "QaIssue",
        entityId: "bulk",
        after: { status: params.status, requested: ids.length, ...summary },
      },
    })
    .catch(() => null);

  return { results, summary };
}
