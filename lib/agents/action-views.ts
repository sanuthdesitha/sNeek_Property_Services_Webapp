/**
 * What Approvals › Agent requests reads (GET /api/admin/agent-requests).
 * Plain module: the route builds it and the client tab renders it.
 */
import type { AgentRequestStatus } from "./write-scopes";

export const AGENT_ACTION_LABEL: Readonly<Record<string, string>> = {
  request_reschedule_job: "Reschedule a job",
  request_case_note: "Internal note on a case",
  request_create_case: "Open a case",
  request_acknowledge_stock_need: "Acknowledge a stock need",
};

export type AgentRequestView = {
  id: string;
  agentName: string;
  /** ACTIVE | REVOKED */
  agentStatus: string;
  tool: string;
  toolLabel: string;
  status: AgentRequestStatus;
  statusLabel: string;
  /** The exact proposed change in plain words; "Not recorded" when missing. */
  summary: string;
  details: string[];
  effects: string[];
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  /** The recorded outcome (done message or the reason it was not applied). */
  outcome: string | null;
  /** Whether the viewer could decide it now, and why not. */
  canDecide: boolean;
  refusal: string | null;
  /** The approver's own PIN is asked for (where the same action by a person needs one). */
  needsPin: boolean;
};

export type AgentRequestsResponse = {
  paused: boolean;
  waiting: AgentRequestView[];
  history: AgentRequestView[];
};
