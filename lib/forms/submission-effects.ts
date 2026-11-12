import "server-only";
/**
 * Server half of question effects for the cleaner submit route. Everything
 * here runs inside the submission's transaction and only DECIDES or RECORDS;
 * the actual work goes through existing paths:
 *
 *  - damage:   returns damage items for the submit route's existing
 *              "reported damage" loop (one private DAMAGE case per item via
 *              createCase) — only when the cleaner has not already submitted
 *              a damage report for this job and sent no damage items with the
 *              form. No second damage path.
 *  - urgent:   returns the urgent stock requests to put on the submission's
 *              durable follow-up receipt (lib/cleaner/submission-followups.ts),
 *              which calls lib/inventory/urgent-stock.ts after commit and
 *              retries failures. Items the property does not stock are
 *              recorded as skipped with that reason instead of retried forever.
 *  - record:   `__formEffects` on the submission says what was decided and why.
 */
import type { Prisma } from "@prisma/client";
import type { DamagePrompt, SubmissionEffectsPlan, UrgentStockRequest } from "./form-effects";

export type FormDamageItem = { title: string; description: string; area?: string; severity: "MEDIUM" };

export type DamageEffectOutcome = DamagePrompt & {
  outcome: "case-from-form" | "covered-by-damage-report" | "covered-by-form-damage-items";
};

export type UrgentEffectOutcome = UrgentStockRequest & {
  outcome: "queued" | "skipped";
  reason?: string;
};

export type FormEffectsRecord = {
  stockCounts: SubmissionEffectsPlan["stockCounts"];
  damage: DamageEffectOutcome[];
  urgentStock: UrgentEffectOutcome[];
};

type DamageReader = Pick<Prisma.TransactionClient, "damageReport">;
type StockReader = Pick<Prisma.TransactionClient, "propertyStock">;

/**
 * Damage items to add to the submit route's damage loop for "opens a damage
 * report" answers. Nothing is added when the cleaner already reported damage
 * for this job (a submitted damage report) or sent damage items with the form:
 * the answer is then covered and a second case would double-report it.
 */
export async function damageItemsForEffects(
  tx: DamageReader,
  input: { jobId: string; cleanerId: string; prompts: DamagePrompt[]; submittedDamageItems: number },
): Promise<{ items: FormDamageItem[]; outcomes: DamageEffectOutcome[] }> {
  if (input.prompts.length === 0) return { items: [], outcomes: [] };
  if (input.submittedDamageItems > 0) {
    return { items: [], outcomes: input.prompts.map((prompt) => ({ ...prompt, outcome: "covered-by-form-damage-items" as const })) };
  }
  const report = await tx.damageReport.findFirst({
    where: { jobId: input.jobId, reportedById: input.cleanerId, status: { not: "DRAFT" } },
    select: { id: true },
  });
  if (report) {
    return { items: [], outcomes: input.prompts.map((prompt) => ({ ...prompt, outcome: "covered-by-damage-report" as const })) };
  }
  const items = input.prompts.map<FormDamageItem>((prompt) => ({
    title: (prompt.category ? `${prompt.category}: ${prompt.label}` : prompt.label).slice(0, 160),
    description: `Reported in the job form: "${prompt.label}" was answered ${prompt.when === "yes" ? "Yes" : "No"}. The cleaner did not submit a damage report with details or photos.`,
    ...(prompt.area ? { area: prompt.area.slice(0, 160) } : {}),
    severity: "MEDIUM",
  }));
  return { items, outcomes: input.prompts.map((prompt) => ({ ...prompt, outcome: "case-from-form" as const })) };
}

/** Which urgent requests go on the follow-up receipt; unstocked items are recorded as skipped. */
export async function urgentRequestsForEffects(
  tx: StockReader,
  input: { propertyId: string; requests: UrgentStockRequest[] },
): Promise<{ queued: UrgentStockRequest[]; outcomes: UrgentEffectOutcome[] }> {
  if (input.requests.length === 0) return { queued: [], outcomes: [] };
  const stocked = await tx.propertyStock.findMany({
    where: { propertyId: input.propertyId, itemId: { in: input.requests.map((request) => request.itemId) } },
    select: { itemId: true },
  });
  const stockedIds = new Set(stocked.map((row) => row.itemId));
  const queued: UrgentStockRequest[] = [];
  const outcomes: UrgentEffectOutcome[] = [];
  for (const request of input.requests) {
    if (stockedIds.has(request.itemId)) {
      queued.push(request);
      outcomes.push({ ...request, outcome: "queued" });
    } else {
      outcomes.push({ ...request, outcome: "skipped", reason: "This property does not stock the item, so no urgent need could be raised." });
    }
  }
  return { queued, outcomes };
}
