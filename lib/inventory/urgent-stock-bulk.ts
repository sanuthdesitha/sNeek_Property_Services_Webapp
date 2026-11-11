/**
 * Bulk actions on urgent stock needs: one request, one answer per need.
 *
 * Each need goes through `actOnUrgentStock` — the same transaction, scope
 * check, version check, receipt and transition policy as a single action — so
 * a need at the wrong stage, changed since it was listed, or not allowed for
 * this actor is refused with the policy's own reason and never reported done.
 * Retrying the same bulk request reuses one receipt per need, so a retry after
 * a lost answer cannot record anything twice.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { actOnUrgentStock, requireUrgentStockAdmin, type StockActor, type UrgentNeed } from "./urgent-stock";
import { URGENT_BULK_ACTIONS, URGENT_BULK_TARGET } from "./urgent-stock-actions";

export const URGENT_BULK_MAX = 50;

export const urgentBulkInput = z.object({
  action: z.enum(URGENT_BULK_ACTIONS),
  bulkRequestId: z.string().uuid(),
  reason: z.string().trim().min(1, "Record a reason for this action.").max(2000),
  needs: z.array(z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict()).min(1).max(URGENT_BULK_MAX),
}).strict();

export type UrgentBulkResult = {
  id: string;
  outcome: "done" | "refused";
  message: string;
  need?: UrgentNeed;
};

/** A stable request id per need inside one bulk request (UUID-shaped). */
export function bulkRowRequestId(bulkRequestId: string, needId: string): string {
  const hex = createHash("sha256").update(`${bulkRequestId}:${needId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function refusal(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not record this action.";
  if (message === "FORBIDDEN") return "You cannot act on this property.";
  if (message === "NOT_FOUND") return "This need no longer exists.";
  return message.replace(/^CONFLICT: /, "");
}

export async function runUrgentStockBulk(actor: StockActor, raw: unknown): Promise<{ results: UrgentBulkResult[] }> {
  const input = urgentBulkInput.parse(raw);
  await requireUrgentStockAdmin(actor);
  const stage = URGENT_BULK_TARGET[input.action];
  const seen = new Set<string>();
  const results: UrgentBulkResult[] = [];
  for (const row of input.needs) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    try {
      const need = await actOnUrgentStock(actor, {
        reportId: row.id,
        requestId: bulkRowRequestId(input.bulkRequestId, row.id),
        expectedVersion: row.expectedVersion,
        stage,
        reason: input.reason,
        observedCount: null,
        observedAt: null,
        needResolved: false,
      });
      results.push({ id: row.id, outcome: "done", message: "Recorded.", need });
    } catch (error) {
      results.push({ id: row.id, outcome: "refused", message: refusal(error) });
    }
  }
  return { results };
}
