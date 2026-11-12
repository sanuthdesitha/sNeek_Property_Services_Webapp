import "server-only";
import { PayAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getClientApprovalById } from "@/lib/commercial/client-approvals";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { getOpsAccess, getOpsGrants } from "@/lib/rbac/ops-access";
import { APPROVAL_QUEUES, type ApprovalsQueueKey, type BulkDecision } from "./queues";
import { BONUS_SOURCES, RECTIFICATION_SOURCES } from "./sources";

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

/** Which single-decision handler a row goes to. */
export type DecisionTarget =
  | "payAdjustment"
  | "timeAdjustment"
  | "timing"
  | "cleanerInvoice"
  | "clientApproval"
  | "jobTask"
  | "skip"
  | "qaRework"
  | "qaOutcome"
  | "qaIssue";

export type DecisionRequest = {
  target: DecisionTarget;
  /** The single route's path, used for the access check and the request URL. */
  path: string;
  method: "PATCH" | "POST";
  /** Route params passed to the handler ({ id }) — absent for collection routes. */
  params: { id: string } | null;
  body: Record<string, unknown>;
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
  actor: BulkActor;
  invoke: DecisionInvoker;
};

function noteFields(note: string | null | undefined, visible: boolean | undefined): Record<string, string> {
  const text = note?.trim();
  if (!text) return {};
  // adminNote is private; decisionMessage is what the payee reads.
  return visible ? { decisionMessage: text } : { adminNote: text };
}

/** The single-decision request a bulk row stands for. Pure; exported for tests. */
export function decisionRequestFor(
  queue: ApprovalsQueueKey,
  decision: BulkDecision,
  id: string,
  note?: string | null,
  noteVisibleToPayee?: boolean,
): DecisionRequest | null {
  const approve = decision === "approve";
  const trimmed = note?.trim() || undefined;
  switch (queue) {
    case "payAdjustments":
    case "rectificationAdjustments":
    case "bonusProposals":
      if (approve && queue === "payAdjustments") return null;
      return {
        target: "payAdjustment",
        path: `/api/admin/pay-adjustments/${id}`,
        method: "PATCH",
        params: { id },
        body: approve ? { status: "APPROVED" } : { status: "REJECTED", ...noteFields(note, noteVisibleToPayee) },
      };
    case "timeAdjustments":
      if (approve) return null;
      return { target: "timeAdjustment", path: `/api/admin/time-adjustments/${id}`, method: "PATCH", params: { id }, body: { status: "REJECTED", ...(trimmed ? { adminNote: trimmed } : {}) } };
    case "timingRequests":
      return { target: "timing", path: `/api/admin/job-early-checkouts/${id}`, method: "PATCH", params: { id }, body: { status: approve ? "APPROVED" : "DECLINED" } };
    case "cleanerInvoicePayClaims":
      if (approve) return null;
      return { target: "cleanerInvoice", path: `/api/admin/cleaner-invoices/${id}`, method: "PATCH", params: { id }, body: { status: "SUBMITTED" } };
    case "clientApprovals":
      return { target: "clientApproval", path: `/api/admin/client-approvals/${id}`, method: "PATCH", params: { id }, body: { status: approve ? "APPROVED" : "DECLINED" } };
    case "clientRequests":
    case "rescheduleRequests":
      return { target: "jobTask", path: `/api/admin/job-tasks/${id}`, method: "PATCH", params: { id }, body: { decision: approve ? "APPROVE" : "REJECT", ...(trimmed ? { note: trimmed } : {}) } };
    case "skipRequests":
      return { target: "skip", path: `/api/admin/jobs/${id}/skip`, method: "PATCH", params: { id }, body: { action: approve ? "approve" : "decline" } };
    case "qaReworkTransfers":
      return { target: "qaRework", path: `/api/admin/qa/rework-transfers/${id}`, method: "PATCH", params: { id }, body: { status: approve ? "APPROVED" : "REJECTED" } };
    case "qaOutcomes":
      if (!approve) return null;
      return { target: "qaOutcome", path: "/api/admin/qa/outcomes", method: "POST", params: null, body: { jobIds: [id] } };
    case "falseConfirmations":
      return { target: "qaIssue", path: `/api/admin/qa/issues/${id}`, method: "PATCH", params: { id }, body: { action: "falseConfirmation", decision: approve ? "CONFIRMED" : "REJECTED" } };
    default:
      return null;
  }
}

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

export async function runBulkDecision(input: BulkDecisionInput): Promise<BulkDecisionResult> {
  const { queue, decision, actor, invoke } = input;
  const rule = APPROVAL_QUEUES[queue].bulk[decision];
  if (!rule.allowed) throw new BulkDecisionNotAllowed(rule.reason);
  const ids = Array.from(new Set(input.ids));
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
