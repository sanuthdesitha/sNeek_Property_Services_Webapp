/**
 * Settings › Access › Agents: the screen's named data types, labels and the
 * wording for values that are missing. Plain module (no React), so the
 * workspace, its parts and the tests read the same rules.
 *
 * Missing values are words ("Never", "Nothing", "No live token"), never a dash
 * and never zero. Times are shown in the organisation timezone.
 */
import { AGENT_SCOPES, type AgentScopeKey } from "@/lib/agents/scopes";
import { AGENT_WRITE_SCOPES, type AgentWriteScopeKey } from "@/lib/agents/write-scopes";

/** One call record as the agents list returns it (AgentAuditEntry). */
export type AgentCallRecord = {
  at: string;
  method: string;
  tool: string | null;
  outcome: string;
  errorCode: string | null;
  latencyMs: number;
  resultBytes: number | null;
};

export type AgentTokenSummary = { prefix: string; expiresAt: string; lastUsedAt: string | null; expired: boolean };

export type AgentItem = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  createdBy: string;
  areas: string[];
  effective: AgentScopeKey[];
  withheld: AgentScopeKey[];
  writeAreas: string[];
  writeEffective: AgentWriteScopeKey[];
  writeWithheld: AgentWriteScopeKey[];
  waitingRequests: number;
  token: AgentTokenSummary | null;
  recentCalls: AgentCallRecord[];
};

/** GET /api/admin/agents. */
export type AgentsScreenState = {
  paused: boolean;
  agents: AgentItem[];
  grantable: AgentScopeKey[];
  grantableWrite: AgentWriteScopeKey[];
  mcpUrl: string;
};

export type AgentDraft = { name: string; areas: AgentScopeKey[]; writeAreas: AgentWriteScopeKey[]; expiresInDays: number };

/** Today's default expiry for a new agent and a rotated token (unchanged). */
export const DEFAULT_EXPIRY_DAYS = 90;

export const EMPTY_AGENT_DRAFT: AgentDraft = { name: "", areas: [], writeAreas: [], expiresInDays: DEFAULT_EXPIRY_DAYS };

/** The change waiting for the administrator's own PIN. */
export type PendingChange =
  | { kind: "create"; draft: AgentDraft }
  | { kind: "write-areas"; agent: AgentItem; writeAreas: AgentWriteScopeKey[] }
  | { kind: "rotate"; agent: AgentItem; expiresInDays: number }
  | { kind: "revoke"; agent: AgentItem }
  | { kind: "pause"; paused: boolean };

/** A token shown once after create or rotate. */
export type RevealedToken = { agentName: string; token: string; expiresAt: string };

const SCOPE_LABEL = new Map<string, string>(AGENT_SCOPES.map((scope) => [scope.key, scope.label]));
const WRITE_LABEL = new Map<string, string>(AGENT_WRITE_SCOPES.map((scope) => [scope.key, scope.label]));

export function readAreaLabel(key: string): string {
  return SCOPE_LABEL.get(key) ?? key;
}

export function writePackLabel(key: string): string {
  return WRITE_LABEL.get(key) ?? key;
}

export function isWritePackKey(key: string): key is AgentWriteScopeKey {
  return WRITE_LABEL.has(key);
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "13 Nov 2026, 11:00 am" in the organisation timezone; "Never" when there is no time. */
export function formatWhen(iso: string | null, timeZone: string): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not known";
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
}

/** True for an agent that could connect now: active with an unexpired token. */
export function hasValidToken(agent: AgentItem): boolean {
  return agent.status === "ACTIVE" && agent.token !== null && !agent.token.expired;
}

export type AgentFlag = { tone: "attention" | null; label: string };

/** The card's band: honey (with the written reason) when something is withheld or the token cannot be used. */
export function agentFlag(agent: AgentItem): AgentFlag {
  if (agent.status !== "ACTIVE") return { tone: null, label: "Revoked" };
  if (!agent.token) return { tone: "attention", label: "No live token" };
  if (agent.token.expired) return { tone: "attention", label: "Token expired" };
  const withheld = agent.withheld.length + agent.writeWithheld.length;
  if (agent.withheld.length && agent.writeWithheld.length) return { tone: "attention", label: `${withheld} withheld` };
  if (agent.withheld.length) return { tone: "attention", label: `${plural(agent.withheld.length, "area")} withheld` };
  if (agent.writeWithheld.length) return { tone: "attention", label: `${plural(agent.writeWithheld.length, "write pack")} withheld` };
  return { tone: null, label: "Active" };
}

/** The create dialog's sentence: what the agent may read and ask, and that the token is shown once. */
export function createSummary(draft: AgentDraft): string {
  const asks = draft.writeAreas.length
    ? `It may ask to change: ${draft.writeAreas.map(writePackLabel).join(", ")}.`
    : "It may ask to change nothing: read only.";
  return `It may read ${plural(draft.areas.length, "area")}. ${asks} Its token is shown once after this and expires after ${draft.expiresInDays} days.`;
}
