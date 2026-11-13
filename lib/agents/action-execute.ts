import "server-only";
import { createHash } from "node:crypto";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { heldRoles } from "@/lib/auth/roles";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { verifySensitiveAction, type SensitiveActionCredentials } from "@/lib/security/admin-verification";
import type { SensitiveAction } from "@/lib/security/sensitive-actions";
import { applyReschedule } from "@/lib/phase4/analytics";
import { addCaseComment, createCase } from "@/lib/cases/service";
import { notifyCaseCreated, notifyCaseUpdated } from "@/lib/cases/notifications";
import { actOnUrgentStock, urgentStockOfficeAllowed, type StockActor } from "@/lib/inventory/urgent-stock";
import { agentsPaused, effectiveAgentWriteScopes } from "./access";
import {
  ActionPreconditionError, agentAction, canonicalJson, isAgentActionTool,
  acknowledgeStockArgs, caseNoteArgs, createCaseArgs, rescheduleArgs,
  type ActionPreview, type AgentActionTool,
} from "./action-catalog";
import { readPreview } from "./action-requests";
import type { AgentRequestStatus } from "./write-scopes";

/**
 * Deciding agent requests (step 6). Imported ONLY by the approval route
 * (app/api/admin/agent-requests/[id]/route.ts): there is no path from an MCP
 * call to anything here.
 *
 * Approve, at the moment of the decision:
 *  1. the approver is re-read live (active, ADMIN or OPS_MANAGER) and is
 *     acting as themselves (the route refuses Test as);
 *  2. the request must still be WAITING and unexpired (an expired one is
 *     marked EXPIRED), and "Pause all agents" must be off;
 *  3. the approver must be able to do the action themselves now (ADMIN: full
 *     rights; OPS_MANAGER: Approvals at manage plus the action's own areas at
 *     manage and capability, read from the live policy). ADMIN and
 *     OPS_MANAGER are never treated as the same;
 *  4. the approver's own PIN where the same action by a person needs one;
 *  5. the agent must still be active and still hold the write pack;
 *  6. the dry run runs again: a refused check or a changed entity (the state
 *     the preview was made against) marks the request FAILED with the reason;
 *     nothing is applied silently;
 *  7. the existing domain service runs as the approving person.
 * Every decision and outcome is an append-only AgentActionEvent plus an
 * AuditLog row naming the actual person.
 */

export type ApproverInput = { userId: string; impersonating: boolean };

type Approver = { id: string; name: string | null; email: string | null; role: Role; held: Role[]; isAdmin: boolean };

type RequestRow = Prisma.AgentActionRequestGetPayload<{ include: { agent: true } }>;

export type DecisionOutcome = { status: AgentRequestStatus; message: string };

export class AgentDecisionError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "AgentDecisionError";
  }
}

type ExecuteInput = { approver: Approver; request: RequestRow; args: Record<string, unknown>; preview: ActionPreview };
type ExecuteResult = { message: string; entityId?: string | null };

export type ActionExecutor = {
  /** Set where the same action by a person asks for their own PIN. */
  sensitiveAction?: SensitiveAction;
  /** Null when this approver may do it themselves now; otherwise the reason. */
  approverRefusal: (approver: Approver) => Promise<string | null>;
  execute: (input: ExecuteInput) => Promise<ExecuteResult>;
};

function approverLabel(approver: Approver): string {
  return approver.name || approver.email || "Office";
}

async function managerLevels(approver: Approver) {
  return getOpsAccess({ id: approver.id, role: String(approver.role), heldRoles: approver.held.map(String) });
}

async function areasRefusal(approver: Approver, areas: readonly ("jobs" | "calendar" | "cases")[], reason: string): Promise<string | null> {
  if (approver.isAdmin) return null;
  const levels = await managerLevels(approver);
  if (!levels) return null;
  return areas.every((area) => levels[area] === "manage") ? null : reason;
}

/** A stable request id for the stock service's receipt (a UUID shape made from the agent request id). */
function stockRequestId(requestId: string): string {
  const hex = createHash("sha256").update(`agent-request:${requestId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const ACTION_EXECUTORS: Readonly<Record<AgentActionTool, ActionExecutor>> = {
  request_reschedule_job: {
    approverRefusal: (approver) => areasRefusal(approver, ["jobs", "calendar"], "Rescheduling needs Jobs and Calendar set to Manage in your access."),
    execute: async ({ approver, request, args, preview }) => {
      const input = rescheduleArgs.parse(args);
      const plan = preview.execution as { date: string; expectedUpdatedAt: string; startTime?: string; dueTime?: string | null; endTime?: string | null } | null;
      if (!plan) throw new ActionPreconditionError("The reschedule plan was not recorded.");
      await applyReschedule({
        jobId: input.jobId,
        date: plan.date,
        ...(plan.startTime !== undefined ? { startTime: plan.startTime, dueTime: plan.dueTime ?? null } : {}),
        ...(plan.endTime !== undefined ? { endTime: plan.endTime } : {}),
        userId: approver.id,
        reason: `Agent request from ${request.agent.name}, approved by ${approverLabel(approver)}: ${input.reason}`,
        expectedUpdatedAt: plan.expectedUpdatedAt,
      });
      return { message: "Rescheduled.", entityId: input.jobId };
    },
  },
  request_case_note: {
    approverRefusal: (approver) => areasRefusal(approver, ["cases"], "Adding case notes needs Cases set to Manage in your access."),
    execute: async ({ approver, request, args }) => {
      const input = caseNoteArgs.parse(args);
      const updated = await addCaseComment({ caseId: input.caseId, authorUserId: approver.id, body: `${input.note}\n\n(Proposed by the agent ${request.agent.name}.)`, isInternal: true });
      if (updated) {
        await notifyCaseUpdated({ caseItem: updated, actorLabel: approverLabel(approver), updateNote: "Internal note added", notifyClient: false })
          .catch((error) => logger.error({ err: error instanceof Error ? error.message : "unknown" }, "[agents] case update notice failed"));
      }
      return { message: "Internal note added.", entityId: input.caseId };
    },
  },
  request_create_case: {
    approverRefusal: (approver) => areasRefusal(approver, ["cases"], "Opening cases needs Cases set to Manage in your access."),
    execute: async ({ approver, request, args, preview }) => {
      const input = createCaseArgs.parse(args);
      const links = preview.fingerprint;
      const created = await createCase({
        title: input.title,
        description: input.description ?? null,
        severity: input.severity ?? "MEDIUM",
        caseType: input.caseType,
        source: "AGENT",
        jobId: typeof links.jobId === "string" ? links.jobId : null,
        propertyId: typeof links.propertyId === "string" ? links.propertyId : null,
        clientId: null,
        clientVisible: false,
        metadata: { agentRequestId: request.id, agentName: request.agent.name },
        comment: input.description ? { authorUserId: approver.id, body: input.description, isInternal: true } : null,
      });
      if (!created) throw new Error("The case could not be read back after it was opened.");
      await notifyCaseCreated({ caseItem: created, actorLabel: approverLabel(approver) })
        .catch((error) => logger.error({ err: error instanceof Error ? error.message : "unknown" }, "[agents] case created notice failed"));
      return { message: "Case opened.", entityId: created.id };
    },
  },
  request_acknowledge_stock_need: {
    approverRefusal: async (approver) => {
      const actor: StockActor = { id: approver.id, role: approver.isAdmin ? Role.ADMIN : Role.OPS_MANAGER, heldRoles: approver.held.map(String) };
      return (await urgentStockOfficeAllowed(actor, "manage")) ? null : "Acting on urgent stock needs Inventory at Manage and the \"Act on urgent stock\" permission.";
    },
    execute: async ({ approver, request, args, preview }) => {
      const input = acknowledgeStockArgs.parse(args);
      const version = preview.fingerprint.needVersion;
      if (typeof version !== "number") throw new ActionPreconditionError("The stock need's version was not recorded.");
      const actor: StockActor = { id: approver.id, role: approver.isAdmin ? Role.ADMIN : Role.OPS_MANAGER, heldRoles: approver.held.map(String) };
      await actOnUrgentStock(actor, {
        reportId: input.needId, requestId: stockRequestId(request.id), expectedVersion: version, stage: "ACKNOWLEDGED",
        reason: `${input.reason} (asked by the agent ${request.agent.name})`, observedCount: null, observedAt: null, needResolved: false,
      });
      return { message: "Marked as acknowledged.", entityId: input.needId };
    },
  },
};

async function loadApprover(input: ApproverInput): Promise<Approver> {
  if (input.impersonating) throw new AgentDecisionError(403, "IMPERSONATING", "Agent requests cannot be decided while testing as someone.");
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, email: true, role: true, isActive: true, extraRoles: { select: { role: true } } } });
  if (!user?.isActive) throw new AgentDecisionError(401, "UNAUTHORIZED", "Sign in again.");
  const held = heldRoles(user.role, user.extraRoles.map((row) => row.role));
  const isAdmin = held.includes(Role.ADMIN);
  if (!isAdmin && !held.includes(Role.OPS_MANAGER)) throw new AgentDecisionError(403, "FORBIDDEN", "Only administrators and operations managers decide agent requests.");
  return { id: user.id, name: user.name, email: user.email, role: isAdmin ? Role.ADMIN : Role.OPS_MANAGER, held, isAdmin };
}

/** An operations manager decides agent requests with Approvals at Manage; ADMIN always. */
async function approvalsRefusal(approver: Approver): Promise<string | null> {
  if (approver.isAdmin) return null;
  const levels = await managerLevels(approver);
  return !levels || levels.approvals === "manage" ? null : "Deciding agent requests needs Approvals set to Manage in your access.";
}

async function loadRequest(requestId: string): Promise<RequestRow> {
  const request = await db.agentActionRequest.findUnique({ where: { id: requestId }, include: { agent: true } });
  if (!request) throw new AgentDecisionError(404, "NOT_FOUND", "This agent request no longer exists.");
  return request;
}

function auditData(approverId: string, request: RequestRow, action: string, after: Record<string, unknown>) {
  const preview = readPreview(request.preview);
  return {
    userId: approverId, action, entity: "AgentActionRequest", entityId: request.id,
    after: { agentId: request.agentId, agentName: request.agent.name, tool: request.tool, summary: preview?.summary ?? null, ...after } as Prisma.InputJsonValue,
  };
}

type Transition = { from: AgentRequestStatus; to: AgentRequestStatus; kind: string; actorId: string | null; data?: Prisma.AgentActionRequestUpdateManyMutationInput; detail?: Record<string, unknown>; audit?: { approverId: string; action: string } };

/** Compare-and-set on the status, with its event and audit, in one transaction. */
async function transition(request: RequestRow, step: Transition): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const moved = await tx.agentActionRequest.updateMany({ where: { id: request.id, status: step.from }, data: { status: step.to, ...step.data } });
    if (moved.count !== 1) return false;
    await tx.agentActionEvent.create({ data: {
      requestId: request.id, kind: step.kind, actorId: step.actorId, agentId: request.agentId, fromStatus: step.from, toStatus: step.to,
      detail: (step.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    } });
    if (step.audit) await tx.auditLog.create({ data: auditData(step.audit.approverId, request, step.audit.action, { status: step.to, ...step.detail }) });
    return true;
  });
}

async function requireWaiting(request: RequestRow, now: Date): Promise<void> {
  if (request.status !== "WAITING") throw new AgentDecisionError(409, "DECIDED", "This request has already been decided.");
  if (request.expiresAt.getTime() <= now.getTime()) {
    await transition(request, { from: "WAITING", to: "EXPIRED", kind: "EXPIRED", actorId: null, data: { decidedAt: now } });
    throw new AgentDecisionError(409, "EXPIRED", "This request expired before it was decided. Nothing was changed.");
  }
}

function executorFor(request: RequestRow, executors: Readonly<Record<string, ActionExecutor>>): ActionExecutor {
  const executor = isAgentActionTool(request.tool) ? executors[request.tool] : undefined;
  if (!executor) throw new AgentDecisionError(409, "UNKNOWN_TOOL", "This kind of request can no longer be approved.");
  return executor;
}

function sameFingerprint(before: ActionPreview, after: ActionPreview): boolean {
  return canonicalJson(before.fingerprint) === canonicalJson(after.fingerprint);
}

async function fail(request: RequestRow, from: AgentRequestStatus, approver: Approver, reason: string, now: Date): Promise<DecisionOutcome> {
  await transition(request, {
    from, to: "FAILED", kind: "FAILED", actorId: approver.id,
    data: { error: reason, ...(from === "WAITING" ? { decidedById: approver.id, decidedAt: now } : {}) },
    detail: { reason }, audit: { approverId: approver.id, action: "AGENT_REQUEST_FAILED" },
  });
  return { status: "FAILED", message: reason };
}

export type DecideInput = {
  requestId: string;
  approver: ApproverInput;
  decision: "approve" | "reject";
  reason?: string | null;
  credentials?: SensitiveActionCredentials | null;
};

/** Reject: no execution. Needs the same right to decide as approval; allowed while agents are paused. */
async function reject(request: RequestRow, approver: Approver, reason: string | null, now: Date): Promise<DecisionOutcome> {
  const moved = await transition(request, {
    from: "WAITING", to: "REJECTED", kind: "REJECTED", actorId: approver.id,
    data: { decidedById: approver.id, decidedAt: now, decisionReason: reason },
    detail: { reason }, audit: { approverId: approver.id, action: "AGENT_REQUEST_REJECTED" },
  });
  if (!moved) throw new AgentDecisionError(409, "DECIDED", "This request has already been decided.");
  return { status: "REJECTED", message: "Rejected. Nothing was changed." };
}

async function approve(request: RequestRow, approver: Approver, executor: ActionExecutor, input: DecideInput, now: Date): Promise<DecisionOutcome> {
  if (await agentsPaused()) throw new AgentDecisionError(409, "AGENTS_PAUSED", "All agents are paused. Waiting requests cannot be approved until agents are resumed.");
  if (executor.sensitiveAction) await verifySensitiveAction(approver.id, input.credentials ?? {}, executor.sensitiveAction);

  const writes = request.agent.status === "ACTIVE" ? await effectiveAgentWriteScopes(request.agent) : { effective: [], withheld: [] };
  if (!writes.effective.some((key) => key === request.area)) {
    return fail(request, "WAITING", approver, request.agent.status === "ACTIVE"
      ? "The agent no longer has this write access (it was switched off, or its creator can no longer manage the area). Nothing was applied."
      : "The agent was revoked. Nothing was applied.", now);
  }
  const claimed = await transition(request, {
    from: "WAITING", to: "APPROVED", kind: "APPROVED", actorId: approver.id,
    data: { decidedById: approver.id, decidedAt: now, decisionReason: input.reason ?? null },
    detail: { reason: input.reason ?? null }, audit: { approverId: approver.id, action: "AGENT_REQUEST_APPROVED" },
  });
  if (!claimed) throw new AgentDecisionError(409, "DECIDED", "This request has already been decided.");

  const stored = readPreview(request.preview);
  if (!stored || !isAgentActionTool(request.tool)) return fail(request, "APPROVED", approver, "The request's preview was not recorded, so it cannot be checked. Nothing was applied.", now);
  const args = request.arguments as Record<string, unknown>;
  let fresh: ActionPreview;
  try {
    fresh = await agentAction(request.tool).preview(args);
  } catch (error) {
    const reason = error instanceof ActionPreconditionError ? error.message : "The current state could not be checked.";
    return fail(request, "APPROVED", approver, `${reason} Nothing was applied.`, now);
  }
  if (!sameFingerprint(stored, fresh)) {
    return fail(request, "APPROVED", approver, `${stored.entity.label} changed after the agent asked, so this preview is out of date. Nothing was applied; ask the agent for a new request.`, now);
  }
  try {
    const result = await executor.execute({ approver, request, args, preview: fresh });
    await transition(request, {
      from: "APPROVED", to: "EXECUTED", kind: "EXECUTED", actorId: approver.id,
      data: { executedAt: new Date(), result: { message: result.message, entityId: result.entityId ?? null } },
      detail: { message: result.message, entityId: result.entityId ?? null }, audit: { approverId: approver.id, action: "AGENT_REQUEST_EXECUTED" },
    });
    return { status: "EXECUTED", message: result.message };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "The change could not be made.";
    return fail(request, "APPROVED", approver, reason, now);
  }
}

export async function decideAgentRequest(input: DecideInput, deps: { executors?: Readonly<Record<string, ActionExecutor>>; now?: Date } = {}): Promise<DecisionOutcome> {
  const now = deps.now ?? new Date();
  const approver = await loadApprover(input.approver);
  const decideRefusal = await approvalsRefusal(approver);
  if (decideRefusal) throw new AgentDecisionError(403, "FORBIDDEN", decideRefusal);
  const request = await loadRequest(input.requestId);
  await requireWaiting(request, now);
  const executor = executorFor(request, deps.executors ?? ACTION_EXECUTORS);
  const refusal = await executor.approverRefusal(approver);
  if (refusal) throw new AgentDecisionError(403, "FORBIDDEN", `${refusal} Only someone who could make this change themselves can decide it.`);
  if (input.decision === "reject") return reject(request, approver, input.reason?.trim() || null, now);
  return approve(request, approver, executor, input, now);
}

/** Whether this person could decide a request now (for the list), with the reason when not. */
export async function decisionRefusalFor(input: ApproverInput, tool: string): Promise<string | null> {
  try {
    const approver = await loadApprover(input);
    const decideRefusal = await approvalsRefusal(approver);
    if (decideRefusal) return decideRefusal;
    const executor = isAgentActionTool(tool) ? ACTION_EXECUTORS[tool] : undefined;
    if (!executor) return "This kind of request can no longer be approved.";
    return await executor.approverRefusal(approver);
  } catch (error) {
    return error instanceof Error ? error.message : "You cannot decide this request.";
  }
}

/** Whether the same action by a person needs their own PIN. */
export function decisionNeedsPin(tool: string): boolean {
  return isAgentActionTool(tool) && Boolean(ACTION_EXECUTORS[tool].sensitiveAction);
}
