/**
 * The Cases inbox's queues, filters and sort orders, as server rules.
 *
 * The old workspace loaded 500 cases with every comment and attachment and
 * filtered them in the browser, so a count was "how many of the 500 I happen to
 * hold". These definitions run in the database instead and each queue count is
 * a real total.
 *
 * Queue definitions (all exclude nothing else unless stated):
 * - needsReply  "Needs my reply": open, owned by the viewer, and the most recent
 *               non-internal message on the case was written by the client side
 *               (a CLIENT or VA account). Internal notes and status notes never
 *               count, so an office note does not hide a client's question.
 * - mine        "Awaiting me" (kept from the old screen): open and owned by the viewer.
 * - unowned     open with no owner.
 * - waitingClient "Waiting on client": status WAITING_CLIENT (the old "Awaiting client").
 * - slaRisk     open with an SLA deadline less than 4 hours away or already passed
 *               (the old screen's rule, unchanged).
 * - open        "All open": not RESOLVED or CLOSED.
 * - resolved    "Resolved": RESOLVED or CLOSED.
 * - all         every case.
 *
 * Pure: no database client here, only Prisma `where` shapes and comparators.
 */
import type { Prisma } from "@prisma/client";
import { caseTypeRank } from "@/lib/cases/ordering";

export const CASE_QUEUES = ["needsReply", "mine", "unowned", "waitingClient", "slaRisk", "open", "resolved", "all"] as const;
export type CaseQueue = (typeof CASE_QUEUES)[number];

export const CASE_QUEUE_LABELS: Record<CaseQueue, string> = {
  needsReply: "Needs my reply",
  mine: "Awaiting me",
  unowned: "Unowned",
  waitingClient: "Waiting on client",
  slaRisk: "SLA at risk",
  open: "All open",
  resolved: "Resolved",
  all: "All",
};

/** The old screen's view ids, so a remembered view or old link still lands somewhere meaningful. */
const LEGACY_VIEW_TO_QUEUE: Record<string, CaseQueue> = {
  open: "open",
  mine: "mine",
  awaitingClient: "waitingClient",
  slaRisk: "slaRisk",
  all: "all",
};

export function parseCaseQueue(value: string | null | undefined, fallback: CaseQueue = "open"): CaseQueue {
  if (!value) return fallback;
  if ((CASE_QUEUES as readonly string[]).includes(value)) return value as CaseQueue;
  return LEGACY_VIEW_TO_QUEUE[value] ?? fallback;
}

/** A current queue id or one of the old view ids. */
export function isKnownCaseQueueValue(value: string): boolean {
  return isCaseQueue(value) || value in LEGACY_VIEW_TO_QUEUE;
}

export function isCaseQueue(value: string): value is CaseQueue {
  return (CASE_QUEUES as readonly string[]).includes(value);
}

export const CASE_TYPES = ["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OPS", "SLA", "OTHER"] as const;
export type CaseTypeKey = (typeof CASE_TYPES)[number];
const KNOWN_STORED_TYPES = ["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OPS", "SLA"];

export const CLOSED_CASE_STATUSES = ["RESOLVED", "CLOSED"];
/** The old screen's SLA risk window. */
export const SLA_RISK_WINDOW_MS = 4 * 60 * 60 * 1000;

const CLIENT_SIDE_ROLES = new Set(["CLIENT", "VA"]);

/** True when the latest non-internal message came from the client side. */
export function lastPublicMessageIsFromClient(latestPublicAuthorRole: string | null | undefined): boolean {
  return Boolean(latestPublicAuthorRole && CLIENT_SIDE_ROLES.has(latestPublicAuthorRole));
}

export type CaseFilterInput = {
  q?: string | null;
  caseType?: string | null;
  status?: string | null;
  assigneeUserId?: string | null;
  jobId?: string | null;
  reportId?: string | null;
  clientId?: string | null;
  propertyId?: string | null;
};

/** Filters that are not the queue: search, type, status, owner and links. */
export function buildCaseFilterWhere(filters: CaseFilterInput): Prisma.IssueTicketWhereInput[] {
  const parts: Prisma.IssueTicketWhereInput[] = [];
  if (filters.status) parts.push({ status: filters.status });
  if (filters.caseType === "OTHER") parts.push({ caseType: { notIn: KNOWN_STORED_TYPES } });
  else if (filters.caseType) parts.push({ caseType: filters.caseType });
  if (filters.clientId) parts.push({ clientId: filters.clientId });
  if (filters.propertyId) parts.push({ propertyId: filters.propertyId });
  if (filters.jobId) parts.push({ jobId: filters.jobId });
  if (filters.reportId) parts.push({ reportId: filters.reportId });
  if (filters.assigneeUserId === "__unassigned") parts.push({ assignedToUserId: null });
  else if (filters.assigneeUserId) parts.push({ assignedToUserId: filters.assigneeUserId });
  const q = filters.q?.trim();
  if (q) {
    parts.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { resolutionNote: { contains: q, mode: "insensitive" } },
        { job: { jobNumber: { contains: q, mode: "insensitive" } } },
        { property: { name: { contains: q, mode: "insensitive" } } },
        { client: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  return parts;
}

export type QueueContext = {
  viewerId: string;
  now: Date;
  /** Ids that satisfy "needs my reply" (computed from the latest public message). */
  needsReplyIds: readonly string[];
};

const OPEN_WHERE: Prisma.IssueTicketWhereInput = { status: { notIn: CLOSED_CASE_STATUSES } };

export function buildQueueWhere(queue: CaseQueue, context: QueueContext): Prisma.IssueTicketWhereInput {
  switch (queue) {
    case "needsReply":
      return { AND: [OPEN_WHERE, { assignedToUserId: context.viewerId }, { id: { in: [...context.needsReplyIds] } }] };
    case "mine":
      return { AND: [OPEN_WHERE, { assignedToUserId: context.viewerId }] };
    case "unowned":
      return { AND: [OPEN_WHERE, { assignedToUserId: null }] };
    case "waitingClient":
      return { status: "WAITING_CLIENT" };
    case "slaRisk":
      return { AND: [OPEN_WHERE, { slaBreachAt: { not: null, lt: new Date(context.now.getTime() + SLA_RISK_WINDOW_MS) } }] };
    case "open":
      return OPEN_WHERE;
    case "resolved":
      return { status: { in: CLOSED_CASE_STATUSES } };
    case "all":
    default:
      return {};
  }
}

/** The candidates for "needs my reply": open cases the viewer owns. */
export function needsReplyCandidateWhere(viewerId: string): Prisma.IssueTicketWhereInput {
  return { AND: [OPEN_WHERE, { assignedToUserId: viewerId }] };
}

// ── Sorting ────────────────────────────────────────────────────────────────

export const CASE_SORTS = ["sla", "created", "updated", "priority", "type"] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

/** The few columns sorting needs; read for every match, never with bodies. */
export type CaseSortKey = {
  id: string;
  status: string;
  severity: string;
  caseType: string | null;
  slaBreachAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
function severityRank(value: string): number {
  return SEVERITY_RANK[String(value).toUpperCase()] ?? 2;
}

function slaTime(row: CaseSortKey): number | null {
  if (!row.slaBreachAt || CLOSED_CASE_STATUSES.includes(row.status)) return null;
  const ms = row.slaBreachAt.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Damage first, then newest — the existing working order — as the final tie-break. */
function workingOrder(a: CaseSortKey, b: CaseSortKey): number {
  const rank = caseTypeRank(a.caseType) - caseTypeRank(b.caseType);
  if (rank !== 0) return rank;
  const recency = b.updatedAt.getTime() - a.updatedAt.getTime();
  if (recency !== 0) return recency;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compareCases(sort: CaseSort, dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return (a: CaseSortKey, b: CaseSortKey): number => {
    let primary = 0;
    switch (sort) {
      case "sla": {
        const ta = slaTime(a);
        const tb = slaTime(b);
        // Cases without a live deadline always come after those with one.
        if (ta === null && tb !== null) return 1;
        if (tb === null && ta !== null) return -1;
        primary = ta !== null && tb !== null ? (ta - tb) * sign : 0;
        break;
      }
      case "created":
        primary = (a.createdAt.getTime() - b.createdAt.getTime()) * sign;
        break;
      case "updated":
        primary = (a.updatedAt.getTime() - b.updatedAt.getTime()) * sign;
        break;
      case "priority":
        // desc = most severe first.
        primary = (severityRank(b.severity) - severityRank(a.severity)) * sign;
        break;
      case "type":
        // asc = damage first (the existing working order).
        primary = (caseTypeRank(a.caseType) - caseTypeRank(b.caseType)) * sign;
        break;
    }
    return primary !== 0 ? primary : workingOrder(a, b);
  };
}

/** Default direction for each sort, matching the labels on screen. */
export const CASE_SORT_DEFAULT_DIR: Record<CaseSort, "asc" | "desc"> = {
  sla: "asc",
  created: "desc",
  updated: "desc",
  priority: "desc",
  type: "asc",
};
