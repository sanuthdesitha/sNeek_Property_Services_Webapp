/**
 * Recent-call outcome wording for Settings › Access › Agents.
 *
 * Read only from the stored call record (AgentAuditEntry: outcome, error code,
 * tool). Nothing is looked up or guessed: a write tool call that succeeded only
 * proves a request was sent to Approvals, not that it is still waiting, so it
 * says "Sent to Approvals". An outcome or code this screen does not know is
 * said in words, never shown as success.
 */
import type { AgentCallRecord } from "./agent-model";

export type CallOutcomeTone = "ok" | "info" | "bad" | "neutral";

export type CallOutcome = { label: string; tone: CallOutcomeTone };

/** Why the server refused the token (AgentAuthCode in lib/agents/access.ts). */
const REFUSED_REASON: Record<string, string> = {
  MISSING_TOKEN: "no token sent",
  INVALID_TOKEN: "token not valid",
  EXPIRED: "token expired",
  REVOKED: "token revoked",
  AGENTS_PAUSED: "agents paused",
  CREATOR_INACTIVE: "its creator has no access",
  RATE_LIMITED: "too many requests",
  DAILY_BUDGET: "daily budget used up",
};

/** Why a call was not accepted (error codes written by lib/agents/mcp.ts). */
const INVALID_REASON: Record<string, string> = {
  UNKNOWN_TOOL: "unknown tool",
  ARGUMENTS: "invalid arguments",
  PARSE: "not a valid request",
  BATCH: "batch requests are not supported",
  METHOD: "method not supported",
  ToolInputError: "the request was not accepted",
};

const WRITE_TOOL_PREFIX = "request_";

export function callOutcome(call: AgentCallRecord): CallOutcome {
  const code = call.errorCode ?? "";
  switch (call.outcome) {
    case "OK":
      if (call.tool?.startsWith(WRITE_TOOL_PREFIX)) return { label: "Sent to Approvals", tone: "info" };
      return { label: "Allowed", tone: "ok" };
    case "REFUSED":
      return { label: `Refused: ${REFUSED_REASON[code] ?? "reason not recorded"}`, tone: "bad" };
    case "DENIED":
      return { label: code === "SCOPE" ? "Refused: not in its access" : "Refused: not allowed for this agent", tone: "bad" };
    case "INVALID":
      return { label: `Refused: ${INVALID_REASON[code] ?? "reason not recorded"}`, tone: "bad" };
    case "ERROR":
      return { label: "Failed: the data could not be read", tone: "bad" };
    default:
      return { label: `Outcome not known (${call.outcome || "not recorded"})`, tone: "neutral" };
  }
}

/** "42 ms · 900 bytes"; bytes only when recorded. */
export function callCost(call: AgentCallRecord): string {
  return call.resultBytes !== null ? `${call.latencyMs} ms · ${call.resultBytes} bytes` : `${call.latencyMs} ms`;
}
