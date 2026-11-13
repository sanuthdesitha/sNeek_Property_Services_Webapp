import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendAgentRequestNotice } from "@/lib/notifications/agent-requests";
import { agentsPaused, type AgentContext } from "./access";
import { ActionPreconditionError, agentAction, canonicalJson, splitIdempotencyKey, type ActionPreview, type AgentActionTool } from "./action-catalog";
import { AGENT_REQUEST_EXPIRY_HOURS, type AgentRequestStatus } from "./write-scopes";

/**
 * Agent requests (step 6): the ONLY thing an agent's write tool does is create
 * one of these, WAITING for a person. This module never executes anything and
 * never imports the executor (lib/agents/action-execute.ts); a test walks the
 * MCP server's imports to keep it that way.
 */

/** The request was refused before anything was stored; the agent is told why. */
export class AgentRequestRefused extends Error {
  constructor(public code: "SCOPE" | "PAUSED" | "ARGUMENTS" | "KEY_REUSED" | "PRECONDITION", message: string) {
    super(message);
    this.name = "AgentRequestRefused";
  }
}

/** What an agent sees about one of its requests. */
export type AgentRequestReceipt = {
  requestId: string;
  status: AgentRequestStatus;
  tool: string;
  summary: string;
  details: string[];
  effects: string[];
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  outcome: string | null;
  /** True when this call returned an earlier request with the same key. */
  repeated?: boolean;
  approversNotified?: number | "not recorded";
};

type RequestRow = Prisma.AgentActionRequestGetPayload<Record<string, never>>;

export function readPreview(value: Prisma.JsonValue): ActionPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preview = value as Record<string, unknown>;
  if (typeof preview.summary !== "string" || !Array.isArray(preview.details)) return null;
  return value as unknown as ActionPreview;
}

function outcomeText(row: RequestRow): string | null {
  if (row.status === "EXECUTED") return typeof row.result === "object" && row.result && "message" in row.result ? String((row.result as { message: unknown }).message) : "Done.";
  if (row.status === "FAILED") return row.error ?? "Not applied; no reason was recorded.";
  if (row.status === "REJECTED") return "A person rejected this request. Nothing was changed.";
  if (row.status === "EXPIRED") return "Nobody decided within the time allowed. Nothing was changed.";
  if (row.status === "APPROVED") return "Approved; the outcome has not been recorded yet.";
  return null;
}

export function receiptFor(row: RequestRow, now = new Date()): AgentRequestReceipt {
  const preview = readPreview(row.preview);
  // Past its expiry but not yet swept: it can no longer be approved, so it reads as expired.
  const lapsed = row.status === "WAITING" && row.expiresAt.getTime() <= now.getTime();
  if (lapsed) return { ...receiptFor({ ...row, status: "EXPIRED" }, now) };
  return {
    requestId: row.id,
    status: row.status as AgentRequestStatus,
    tool: row.tool,
    summary: preview?.summary ?? "Not recorded",
    details: preview?.details ?? [],
    effects: preview?.effects ?? [],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    outcome: outcomeText(row),
  };
}

function sameArguments(stored: Prisma.JsonValue, next: Record<string, unknown>): boolean {
  return canonicalJson(stored) === canonicalJson(next);
}

async function existingByKey(agentId: string, key: string) {
  return db.agentActionRequest.findUnique({ where: { agentId_idempotencyKey: { agentId, idempotencyKey: key } } });
}

function repeatOf(row: RequestRow, tool: AgentActionTool, args: Record<string, unknown>): AgentRequestReceipt {
  if (row.tool !== tool || !sameArguments(row.arguments, args)) {
    throw new AgentRequestRefused("KEY_REUSED", "This idempotency key was already used for a different request. Use a new key for a new request.");
  }
  return { ...receiptFor(row), repeated: true };
}

function notifiedCount(outcomes: { state: string }[]): number {
  return outcomes.filter((outcome) => outcome.state === "inbox_available" || outcome.state === "queued").length;
}

/**
 * Validates, checks the agent's write pack, runs the dry run and stores a
 * WAITING request. A repeated idempotency key with the same arguments returns
 * the same request; with different arguments it is refused.
 */
export async function proposeAgentAction(context: AgentContext, tool: AgentActionTool, rawArgs: Record<string, unknown>, now = new Date()): Promise<AgentRequestReceipt> {
  const action = agentAction(tool);
  if (!context.writeScopes.includes(action.writeScope)) {
    throw new AgentRequestRefused("SCOPE", `This agent cannot ask for this: the "${action.writeScope}" write pack is off, or its creator can no longer manage that area.`);
  }
  const { key, rest } = splitIdempotencyKey(rawArgs);
  if (!key.success) throw new AgentRequestRefused("ARGUMENTS", "Send an idempotencyKey of 8 to 100 letters, digits or _ . : - characters.");
  const parsed = action.input.safeParse(rest);
  if (!parsed.success) {
    throw new AgentRequestRefused("ARGUMENTS", parsed.error.issues.map((issue) => `${issue.path.join(".") || "(arguments)"} ${issue.message}`).join("; "));
  }
  const args = parsed.data;
  const earlier = await existingByKey(context.agentId, key.data);
  if (earlier) return repeatOf(earlier, tool, args);
  // Authentication already refused a paused service; re-read it so a pause
  // made between authentication and now still stops the request.
  if (await agentsPaused()) throw new AgentRequestRefused("PAUSED", "All agents are paused by an administrator.");

  let preview: ActionPreview;
  try {
    preview = await action.preview(args);
  } catch (error) {
    if (error instanceof ActionPreconditionError) throw new AgentRequestRefused("PRECONDITION", error.message);
    throw error;
  }

  let row: RequestRow;
  try {
    row = await db.$transaction(async (tx) => {
      const created = await tx.agentActionRequest.create({ data: {
        agentId: context.agentId, tokenId: context.tokenId, creatorId: context.creatorId,
        tool, area: action.writeScope, arguments: args as Prisma.InputJsonValue, preview: preview as unknown as Prisma.InputJsonValue,
        idempotencyKey: key.data, status: "WAITING", expiresAt: new Date(now.getTime() + AGENT_REQUEST_EXPIRY_HOURS * 3_600_000),
      } });
      await tx.agentActionEvent.create({ data: { requestId: created.id, kind: "CREATED", agentId: context.agentId, actorId: null, fromStatus: null, toStatus: "WAITING", detail: { tool, summary: preview.summary } } });
      return created;
    });
  } catch (error) {
    // Two calls with the same key at once: the loser returns the winner's request.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await existingByKey(context.agentId, key.data);
      if (winner) return repeatOf(winner, tool, args);
    }
    throw error;
  }

  let approversNotified: number | "not recorded" = "not recorded";
  try {
    approversNotified = notifiedCount(await sendAgentRequestNotice({ requestId: row.id, agentName: context.agentName, summary: preview.summary }));
  } catch (error) {
    // The request stands; the notice failing is logged, never reported as sent.
    logger.error({ err: error instanceof Error ? error.message : "unknown", requestId: row.id }, "[agents] request notice failed");
  }
  return { ...receiptFor(row), approversNotified };
}

/** One of this agent's own requests (any other agent's request reads as not found). */
export async function agentRequestStatus(context: AgentContext, requestId: string): Promise<AgentRequestReceipt | null> {
  const row = await db.agentActionRequest.findFirst({ where: { id: requestId, agentId: context.agentId } });
  return row ? receiptFor(row) : null;
}

/**
 * Hourly sweep: WAITING requests past their expiry become EXPIRED, each with
 * an append-only event. An APPROVED request is never expired (its outcome is
 * recorded by the approval).
 */
export async function expireAgentRequests(now = new Date()): Promise<{ expired: number }> {
  const due = await db.agentActionRequest.findMany({ where: { status: "WAITING", expiresAt: { lte: now } }, select: { id: true, agentId: true }, take: 500 });
  let expired = 0;
  for (const item of due) {
    const changed = await db.$transaction(async (tx) => {
      const moved = await tx.agentActionRequest.updateMany({ where: { id: item.id, status: "WAITING", expiresAt: { lte: now } }, data: { status: "EXPIRED", decidedAt: now } });
      if (moved.count !== 1) return false;
      await tx.agentActionEvent.create({ data: { requestId: item.id, kind: "EXPIRED", agentId: item.agentId, actorId: null, fromStatus: "WAITING", toStatus: "EXPIRED" } });
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired };
}
