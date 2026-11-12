import "server-only";
import { PayAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getClientApprovalById, listClientApprovals } from "@/lib/commercial/client-approvals";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";
import { roundCents } from "@/lib/finance/job-money";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { getOpsAccess, getOpsGrants } from "@/lib/rbac/ops-access";
import { APPROVAL_QUEUES, type ApprovalsQueueKey, type BulkDecision } from "./queues";
import { BONUS_SOURCES, RECTIFICATION_SOURCES } from "./sources";
import { decisionRequestFor, type DecisionRequest } from "./decision-requests";

export { decisionRequestFor, type DecisionRequest, type DecisionTarget } from "./decision-requests";

/**
 * Bulk approve / decline for the Approvals page.
 *
 * Every row goes through the queue's EXISTING single-decision route handler,
 * called in process with the same body the side panel sends, so permissions,
 * state checks, notifications and the approval history row are exactly what a
 * single decision does. Nothing here re-implements a decision.
 *
 * - The queue must allow the decision in bulk (APPROVAL_QUEUES[queue].bulk).
 * - An operations manager is checked against the single route's own access
 *   area (e.g. Payroll for pay requests), not only the Approvals area of this
 *   endpoint, because middleware only saw the bulk path.
 * - Rows run one after another; one refusal never stops the rest. Each row
 *   reports done, refused (with the route's reason) or no change.
 */

export type BulkRowStatus = "done" | "refused" | "unchanged";

export type BulkRowOutcome = { id: string; status: BulkRowStatus; message: string };

export type BulkDecisionResult = {
  queue: ApprovalsQueueKey;
  decision: BulkDecision;
  outcomes: BulkRowOutcome[];
  done: number;
  refused: number;
  unchanged: number;
};

export type DecisionInvoker = (request: DecisionRequest) => Promise<{ status: number; body: unknown }>;

export type BulkActor = { id: string; role: string; heldRoles?: string[] };

export type BulkDecisionInput = {
  queue: ApprovalsQueueKey;
  decision: BulkDecision;
  ids: string[];
  /** One note for every row (decline only). */
  note?: string | null;
  /** Pay queues: whether the note is the payee-facing explanation. */
  noteVisibleToPayee?: boolean;
  /**
   * Pay requests approved "as asked": the amount the person saw in the confirm
   * for each id. A row whose asked amount has changed since is refused.
   */
  expectedAmounts?: Record<string, number>;
  actor: BulkActor;
  invoke: DecisionInvoker;
};

/** Why a row is not part of this queue any more, or null when it is. */
async function membershipRefusal(queue: ApprovalsQueueKey, decision: BulkDecision, ids: string[]): Promise<Map<string, string>> {
  const refusals = new Map<string, string>();
  if (queue === "payAdjustments" || queue === "rectificationAdjustments" || queue === "bonusProposals") {
    const rows = await db.cleanerPayAdjustment.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, source: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        refusals.set(id, "This request no longer exists.");
        continue;
      }
      const source = row.source ?? "";
      const inQueue =
        queue === "rectificationAdjustments"
          ? RECTIFICATION_SOURCES.includes(source)
          : queue === "bonusProposals"
            ? BONUS_SOURCES.includes(source)
            : !RECTIFICATION_SOURCES.includes(source) && !BONUS_SOURCES.includes(source);
      if (!inQueue) refusals.set(id, `This is not a ${APPROVAL_QUEUES[queue].noun}.`);
      else if (row.status !== PayAdjustmentStatus.PENDING) refusals.set(id, "Already decided.");
    }
  }
  if (queue === "clientApprovals") {
    for (const id of ids) {
      const approval = (await getClientApprovalById(id)) as { status?: string; metadata?: Record<string, unknown> | null } | null;
      if (!approval) refusals.set(id, "This approval no longer exists.");
      else if (approval.metadata?.source === "pay_adjustment") refusals.set(id, "Only the client can approve a pay request sent to them.");
      else if (approval.status === "COUNTERED" && decision === "approve") refusals.set(id, "The client sent a counter-offer; decide it on its own.");
      else if (approval.status !== "PENDING" && approval.status !== "COUNTERED") refusals.set(id, "Already decided.");
    }
  }
  return refusals;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function outcomeFromResponse(request: DecisionRequest, id: string, status: number, body: unknown): BulkRowOutcome {
  if (status >= 200 && status < 300) {
    if (request.target === "qaOutcome") {
      const skipped = body && typeof body === "object" && Array.isArray((body as { skipped?: unknown }).skipped) ? ((body as { skipped: unknown[] }).skipped as unknown[]) : [];
      if (skipped.includes(id)) return { id, status: "unchanged", message: "No longer awaiting approval." };
    }
    return { id, status: "done", message: "Done." };
  }
  if (status === 409) return { id, status: "refused", message: errorMessage(body, "Already decided or settled.") };
  if (status === 403) return { id, status: "refused", message: errorMessage(body, "You do not have permission for this decision.") };
  return { id, status: "refused", message: errorMessage(body, "The decision was refused.") };
}

async function accessRefusal(actor: BulkActor, request: DecisionRequest): Promise<string | null> {
  const levels = await getOpsAccess(actor);
  if (!levels) return null;
  const grants = await getOpsGrants(actor);
  if (canUseOpsPath(levels, request.path, request.method, grants)) return null;
  return "Your access does not include this decision.";
}

function summarise(queue: ApprovalsQueueKey, decision: BulkDecision, outcomes: BulkRowOutcome[]): BulkDecisionResult {
  return {
    queue,
    decision,
    outcomes,
    done: outcomes.filter((row) => row.status === "done").length,
    refused: outcomes.filter((row) => row.status === "refused").length,
    unchanged: outcomes.filter((row) => row.status === "unchanged").length,
  };
}

export class BulkDecisionNotAllowed extends Error {}

/** Two money amounts are the same to the cent. */
function sameAmount(a: number, b: number): boolean {
  return Math.abs(roundCents(a) - roundCents(b)) < 0.005;
}

function moneyText(amount: number): string {
  return `$${roundCents(amount).toFixed(2)}`;
}

export type PayApprovalPlan = { approve: Map<string, number>; refusals: Map<string, BulkRowOutcome> };

type LinkedApproval = { status: string; amount: number; updatedAt: string | Date; metadata: unknown };

function linkedApprovalFor(approvals: LinkedApproval[], id: string): LinkedApproval | null {
  const mine = approvals.filter((approval) => (approval.metadata as Record<string, unknown> | null)?.payAdjustmentId === id);
  mine.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return mine[0] ?? null;
}

/**
 * Pay requests approved in bulk "as asked" (owner decision 2026-11-13: "bulk
 * approve supports if each is ok to approve"). Each row is approved at ITS OWN
 * asked amount, only when it passes every check approving it on its own needs:
 * still a waiting pay request, a valid asked amount, a receipt attached (the
 * same rule as the list's one-click Approve), a linked client approval already
 * approved (the single route refuses otherwise), and the amount the person
 * confirmed still being the asked amount. No approval limit exists for pay
 * requests, so none is applied. Settled money, self-approval and the viewer's
 * Payroll access are checked again by the single route and the access check.
 * Read only; exported for tests.
 */
export async function planPayApprovals(ids: string[], expectedAmounts: Record<string, number> | undefined): Promise<PayApprovalPlan> {
  const approve = new Map<string, number>();
  const refusals = new Map<string, BulkRowOutcome>();
  const rows = await db.cleanerPayAdjustment.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, source: true, requestedAmount: true, attachmentKeys: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const approvals = ((await listClientApprovals()) as LinkedApproval[]).filter((approval) => {
    const metadata = approval.metadata as Record<string, unknown> | null;
    return metadata?.source === "pay_adjustment" && typeof metadata.payAdjustmentId === "string" && ids.includes(metadata.payAdjustmentId);
  });
  const refuse = (id: string, message: string, status: BulkRowStatus = "refused") => refusals.set(id, { id, status, message });

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      refuse(id, "This request no longer exists.");
      continue;
    }
    const source = row.source ?? "";
    if (RECTIFICATION_SOURCES.includes(source) || BONUS_SOURCES.includes(source)) {
      refuse(id, "This is not a pay request.");
      continue;
    }
    if (row.status !== PayAdjustmentStatus.PENDING) {
      refuse(id, "Already decided.", "unchanged");
      continue;
    }
    const linked = linkedApprovalFor(approvals, id);
    if (linked && linked.status !== "APPROVED") {
      refuse(id, linked.status === "DECLINED" ? "The client declined this charge; review it on its own." : "Waiting for the client's approval.");
      continue;
    }
    const asked = normalizePayAdjustmentAmounts({ requestedAmount: row.requestedAmount }, linked).primaryDisplayAmount;
    if (!Number.isFinite(asked) || asked <= 0) {
      refuse(id, "No valid amount was asked; review it on its own.");
      continue;
    }
    const receipts = Array.isArray(row.attachmentKeys) ? row.attachmentKeys.filter((key) => typeof key === "string" && key.trim()) : [];
    if (receipts.length === 0) {
      refuse(id, "No receipt attached; review it on its own.");
      continue;
    }
    const expected = expectedAmounts?.[id];
    if (typeof expected !== "number" || !Number.isFinite(expected)) {
      refuse(id, "The amount was not confirmed; select it and approve again.");
      continue;
    }
    if (!sameAmount(expected, asked)) {
      refuse(id, `The asked amount is now ${moneyText(asked)} (you confirmed ${moneyText(expected)}). Review it again.`);
      continue;
    }
    approve.set(id, roundCents(asked));
  }
  return { approve, refusals };
}

/** The single pay-request approval: the existing PATCH route with the asked amount, as the panel and the list send it. */
function payApproveRequest(id: string, amount: number): DecisionRequest {
  return { target: "payAdjustment", path: `/api/admin/pay-adjustments/${id}`, method: "PATCH", params: { id }, body: { status: "APPROVED", approvedAmount: amount } };
}

async function runPayApprovals(input: BulkDecisionInput, ids: string[]): Promise<BulkDecisionResult> {
  const { actor, invoke } = input;
  if (ids.length === 0) return summarise(input.queue, input.decision, []);
  const denied = await accessRefusal(actor, payApproveRequest(ids[0], 0));
  if (denied) return summarise(input.queue, input.decision, ids.map((id) => ({ id, status: "refused", message: denied })));
  const plan = await planPayApprovals(ids, input.expectedAmounts);
  const outcomes: BulkRowOutcome[] = [];
  for (const id of ids) {
    const amount = plan.approve.get(id);
    if (amount === undefined) {
      outcomes.push(plan.refusals.get(id) ?? { id, status: "refused", message: "This request cannot be approved in bulk." });
      continue;
    }
    const request = payApproveRequest(id, amount);
    try {
      const response = await invoke(request);
      outcomes.push(outcomeFromResponse(request, id, response.status, response.body));
    } catch (error) {
      outcomes.push({ id, status: "refused", message: error instanceof Error && error.message ? error.message : "The decision failed." });
    }
  }
  return summarise(input.queue, input.decision, outcomes);
}

export async function runBulkDecision(input: BulkDecisionInput): Promise<BulkDecisionResult> {
  const { queue, decision, actor, invoke } = input;
  const rule = APPROVAL_QUEUES[queue].bulk[decision];
  if (!rule.allowed) throw new BulkDecisionNotAllowed(rule.reason);
  const ids = Array.from(new Set(input.ids));
  if (queue === "payAdjustments" && decision === "approve") return runPayApprovals(input, ids);
  const probe = ids[0] ? decisionRequestFor(queue, decision, ids[0], input.note, input.noteVisibleToPayee) : null;
  if (!probe) throw new BulkDecisionNotAllowed("This decision cannot be taken in bulk.");

  const denied = await accessRefusal(actor, probe);
  if (denied) return summarise(queue, decision, ids.map((id) => ({ id, status: "refused", message: denied })));

  const refusals = await membershipRefusal(queue, decision, ids);
  const outcomes: BulkRowOutcome[] = [];
  for (const id of ids) {
    const refusal = refusals.get(id);
    if (refusal) {
      outcomes.push({ id, status: refusal === "Already decided." ? "unchanged" : "refused", message: refusal });
      continue;
    }
    const request = decisionRequestFor(queue, decision, id, input.note, input.noteVisibleToPayee);
    if (!request) {
      outcomes.push({ id, status: "refused", message: "This decision cannot be taken in bulk." });
      continue;
    }
    try {
      const response = await invoke(request);
      outcomes.push(outcomeFromResponse(request, id, response.status, response.body));
    } catch (error) {
      outcomes.push({ id, status: "refused", message: error instanceof Error && error.message ? error.message : "The decision failed." });
    }
  }
  return summarise(queue, decision, outcomes);
}
