import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { agentsPaused } from "./access";
import { readPreview } from "./action-requests";
import { decisionNeedsPin, decisionRefusalFor, type ApproverInput } from "./action-execute";
import { AGENT_ACTION_LABEL, type AgentRequestView, type AgentRequestsResponse } from "./action-views";
import { AGENT_REQUEST_STATUS_LABEL, type AgentRequestStatus } from "./write-scopes";

/** The Agent requests tab: waiting requests (oldest first) and the latest decided ones. */

type Row = Prisma.AgentActionRequestGetPayload<{ include: { agent: { select: { name: true; status: true } } } }>;

const HISTORY_LIMIT = 50;
const WAITING_LIMIT = 200;

function outcome(row: Row): string | null {
  if (row.status === "EXECUTED") {
    const result = row.result as { message?: unknown } | null;
    return typeof result?.message === "string" ? result.message : "Done.";
  }
  if (row.status === "FAILED") return row.error ?? "Not applied; no reason was recorded.";
  if (row.status === "EXPIRED") return "Nobody decided in time. Nothing was changed.";
  if (row.status === "REJECTED") return "Rejected. Nothing was changed.";
  if (row.status === "APPROVED") return "Approved; the outcome has not been recorded.";
  return null;
}

function view(row: Row, deciders: Map<string, string>, refusal: string | null): AgentRequestView {
  const preview = readPreview(row.preview);
  const status = row.status as AgentRequestStatus;
  return {
    id: row.id,
    agentName: row.agent.name,
    agentStatus: row.agent.status,
    tool: row.tool,
    toolLabel: AGENT_ACTION_LABEL[row.tool] ?? row.tool,
    status,
    statusLabel: AGENT_REQUEST_STATUS_LABEL[status] ?? row.status,
    summary: preview?.summary ?? "Not recorded",
    details: preview?.details ?? [],
    effects: preview?.effects ?? [],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedById ? deciders.get(row.decidedById) ?? "Removed account" : null,
    decisionReason: row.decisionReason,
    outcome: outcome(row),
    canDecide: status === "WAITING" && refusal === null,
    refusal: status === "WAITING" ? refusal : null,
    needsPin: decisionNeedsPin(row.tool),
  };
}

export async function listAgentRequests(viewer: ApproverInput, now = new Date()): Promise<AgentRequestsResponse> {
  const include = { agent: { select: { name: true, status: true } } } as const;
  const [waiting, history, paused] = await Promise.all([
    db.agentActionRequest.findMany({ where: { status: "WAITING", expiresAt: { gt: now } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: WAITING_LIMIT, include }),
    db.agentActionRequest.findMany({ where: { OR: [{ status: { not: "WAITING" } }, { expiresAt: { lte: now } }] }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: HISTORY_LIMIT, include }),
    agentsPaused(),
  ]);
  const deciderIds = Array.from(new Set(history.flatMap((row) => (row.decidedById ? [row.decidedById] : []))));
  const people = deciderIds.length ? await db.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true, email: true } }) : [];
  const deciders = new Map(people.map((person) => [person.id, person.name || person.email || "Office"]));
  const refusals = new Map<string, string | null>();
  for (const tool of Array.from(new Set(waiting.map((row) => row.tool)))) refusals.set(tool, await decisionRefusalFor(viewer, tool));
  return {
    paused,
    waiting: waiting.map((row) => view(row, deciders, refusals.get(row.tool) ?? null)),
    // A request past its expiry that the sweep has not reached yet reads as expired, never as waiting.
    history: history.map((row) => (row.status === "WAITING" ? { ...view(row, deciders, null), status: "EXPIRED" as const, statusLabel: AGENT_REQUEST_STATUS_LABEL.EXPIRED, outcome: "Nobody decided in time. Nothing was changed." } : view(row, deciders, null))),
  };
}
