/**
 * Agent scope packs (2026-11-14). Plain module: the Agents screen and the
 * server read the same list. Every pack is READ-ONLY and maps to one existing
 * office area (lib/rbac/ops-catalog.ts); finance packs also need the area's
 * view capability. An agent's effective packs are always the intersection of
 * what it was given and what its creator can read right now.
 */
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import type { CapabilityKey } from "@/lib/rbac/capabilities";

export type AgentScopeKey =
  | "jobs" | "laundry" | "cases" | "approvals" | "stock" | "properties"
  | "people_staff" | "people_clients" | "finance" | "payroll";

export type AgentScopeDefinition = {
  key: AgentScopeKey;
  label: string;
  description: string;
  /** The office area the creator must be able to read. */
  opsArea: OpsFeature;
  /** An extra capability the creator must hold (finance). */
  capability?: CapabilityKey;
};

export const AGENT_SCOPES: readonly AgentScopeDefinition[] = [
  { key: "jobs", label: "Jobs", description: "Today's jobs, a job's details and the live operations summary.", opsArea: "jobs" },
  { key: "laundry", label: "Laundry", description: "Laundry runs for the coming days.", opsArea: "laundry" },
  { key: "cases", label: "Cases", description: "Open cases and issues.", opsArea: "cases" },
  { key: "approvals", label: "Approvals", description: "How many requests are waiting in the main approval queues.", opsArea: "approvals" },
  { key: "stock", label: "Stock", description: "Urgent stock needs.", opsArea: "inventory" },
  { key: "properties", label: "Properties", description: "Find properties (never access codes or key details).", opsArea: "properties" },
  { key: "people_staff", label: "Staff lookup", description: "Find cleaners and other staff by name or email.", opsArea: "workforce" },
  { key: "people_clients", label: "Client lookup", description: "Find clients by name or email.", opsArea: "clients" },
  { key: "finance", label: "Invoices", description: "Recent client invoices and their status.", opsArea: "finance", capability: "invoices.view" },
  { key: "payroll", label: "Pay requests", description: "Cleaner pay requests waiting for a decision.", opsArea: "payroll" },
];

export const AGENT_SCOPE_KEYS: readonly AgentScopeKey[] = AGENT_SCOPES.map((scope) => scope.key);

export function isAgentScopeKey(value: string): value is AgentScopeKey {
  return (AGENT_SCOPE_KEYS as readonly string[]).includes(value);
}

/** Expiry choices offered on the screen (days); the server accepts 1 to 365. */
export const AGENT_EXPIRY_CHOICES = [7, 30, 90, 180, 365] as const;
export const AGENT_MAX_EXPIRY_DAYS = 365;

/** Shared limits per token (RateLimitWindow). */
export const AGENT_LIMITS = { perMinute: 60, perDay: 5000 } as const;

/** Path of the MCP endpoint, below the app's public address. */
export const AGENT_MCP_PATH = "/api/agent/mcp";
