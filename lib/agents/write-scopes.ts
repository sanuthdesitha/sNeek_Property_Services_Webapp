/**
 * Agent WRITE packs (step 6, 2026-11-14). Plain module: the Agents screen,
 * the Approvals tab and the server read the same list.
 *
 * A write pack never lets an agent change anything by itself. It only lets the
 * agent ASK: the request waits in Approvals › Agent requests until a person
 * approves it, and approval runs the existing domain service as that person.
 *
 * Every pack is separate from the read packs (lib/agents/scopes.ts), off by
 * default, and capped by the creator's live MANAGE access to each area it
 * names (re-checked on every agent call): an active ADMIN can hand out every
 * pack; an active OPS_MANAGER only packs whose areas are all at "manage" in
 * their current access (plus the capability where one is named).
 */
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import type { CapabilityKey } from "@/lib/rbac/capabilities";

export type AgentWriteScopeKey = "jobs_reschedule" | "cases_write" | "stock_acknowledge";

export type AgentWriteScopeDefinition = {
  key: AgentWriteScopeKey;
  label: string;
  description: string;
  /** Every office area the creator (and later the approver) must manage. */
  opsAreas: readonly OpsFeature[];
  /** An extra capability the creator (and the approver) must hold. */
  capability?: CapabilityKey;
};

export const AGENT_WRITE_SCOPES: readonly AgentWriteScopeDefinition[] = [
  {
    key: "jobs_reschedule",
    label: "Ask to reschedule jobs",
    description: "Ask to move a job to another day or start time. Approving runs the usual reschedule, which tells the assigned cleaners and the client as it does today.",
    opsAreas: ["jobs", "calendar"],
  },
  {
    key: "cases_write",
    label: "Ask to open cases and add internal notes",
    description: "Ask to open an office case (never a damage case, never visible to the client) or add an internal note to a case.",
    opsAreas: ["cases"],
  },
  {
    key: "stock_acknowledge",
    label: "Ask to acknowledge stock needs",
    description: "Ask to mark an urgent stock need as acknowledged. It places no order and proves no delivery.",
    opsAreas: ["inventory"],
    capability: "inventory.urgent_stock_act",
  },
];

export const AGENT_WRITE_SCOPE_KEYS: readonly AgentWriteScopeKey[] = AGENT_WRITE_SCOPES.map((scope) => scope.key);

export function isAgentWriteScopeKey(value: string): value is AgentWriteScopeKey {
  return (AGENT_WRITE_SCOPE_KEYS as readonly string[]).includes(value);
}

export function agentWriteScope(key: AgentWriteScopeKey): AgentWriteScopeDefinition {
  const found = AGENT_WRITE_SCOPES.find((scope) => scope.key === key);
  if (!found) throw new Error(`Unknown agent write pack ${key}`);
  return found;
}

/** How long a request waits for a decision before the hourly sweep expires it. */
export const AGENT_REQUEST_EXPIRY_HOURS = 24;

export const AGENT_REQUEST_STATUSES = ["WAITING", "APPROVED", "REJECTED", "EXPIRED", "EXECUTED", "FAILED"] as const;
export type AgentRequestStatus = (typeof AGENT_REQUEST_STATUSES)[number];

/** Words for each status. APPROVED alone means "approved, outcome not recorded yet". */
export const AGENT_REQUEST_STATUS_LABEL: Readonly<Record<AgentRequestStatus, string>> = {
  WAITING: "Waiting",
  APPROVED: "Approved, outcome not recorded",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  EXECUTED: "Done",
  FAILED: "Not applied",
};
