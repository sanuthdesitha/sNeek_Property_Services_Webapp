/**
 * Bulk actions on lost and found items: Move to storage, Mark unclaimed,
 * Donate, Dispose. One request, one answer per item. Each item goes through
 * the same single-item change (row lock, transition table, resolution stamp,
 * timeline entry) as the panel, so an item that may not move is refused with
 * the rule's own reason and never reported as done.
 */
import type { LostFoundStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { applyLostFoundChange, LostFoundRuleError } from "./mutations";

export const LOST_FOUND_BULK_ACTIONS = ["move-to-storage", "mark-unclaimed", "donate", "dispose"] as const;
export type LostFoundBulkAction = (typeof LOST_FOUND_BULK_ACTIONS)[number];

export const LOST_FOUND_BULK_TARGET: Record<LostFoundBulkAction, LostFoundStatus> = {
  "move-to-storage": "IN_STORAGE",
  "mark-unclaimed": "UNCLAIMED",
  donate: "DONATED",
  dispose: "DISPOSED",
};

export const LOST_FOUND_BULK_MAX = 100;

export const lostFoundBulkInput = z.object({
  action: z.enum(LOST_FOUND_BULK_ACTIONS),
  ids: z.array(z.string().trim().min(1).max(64)).min(1).max(LOST_FOUND_BULK_MAX),
  /** The same optional note the single action takes (the resolution note for decisions). */
  note: z.string().trim().max(4000).optional().nullable(),
}).strict();

export type LostFoundBulkResult = { id: string; outcome: "done" | "unchanged" | "refused"; message: string };

export async function runLostFoundBulk(actorId: string, raw: unknown): Promise<{ results: LostFoundBulkResult[] }> {
  const input = lostFoundBulkInput.parse(raw);
  const ids = Array.from(new Set(input.ids));
  const target = LOST_FOUND_BULK_TARGET[input.action];
  const current = await db.lostFoundItem.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  const statusById = new Map(current.map((row) => [row.id, row.status]));
  const results: LostFoundBulkResult[] = [];
  for (const id of ids) {
    const status = statusById.get(id);
    if (!status) {
      results.push({ id, outcome: "refused", message: "This item no longer exists." });
      continue;
    }
    if (status === target) {
      results.push({ id, outcome: "unchanged", message: "Already at this status." });
      continue;
    }
    try {
      await applyLostFoundChange(id, actorId, { status: { status: target, note: input.note ?? null, resolution: input.note ?? null } });
      results.push({ id, outcome: "done", message: "Updated." });
    } catch (error) {
      const message = error instanceof LostFoundRuleError ? error.message : error instanceof Error && error.message === "NOT_FOUND" ? "This item no longer exists." : "Could not update this item.";
      results.push({ id, outcome: "refused", message });
    }
  }
  return { results };
}
