/**
 * One table row per waiting request, whatever its queue, so the Approvals
 * list can show every queue with the same columns as drawn: who asked, the
 * job, the type, what was asked and how long it has waited.
 *
 * Plain module (no "use client"). Records come from GET /api/admin/all-approvals
 * unchanged; only the fields read here are typed.
 */
import { APPROVAL_QUEUE_ORDER, type ApprovalsQueueKey } from "./queues";

type Person = { id?: string; name?: string | null; email?: string | null; role?: string | null } | null | undefined;
type PropertyRef = { id?: string; name?: string | null; suburb?: string | null } | null | undefined;
type JobRef = {
  id?: string;
  jobNumber?: string | number | null;
  scheduledDate?: string | null;
  startTime?: string | null;
  status?: string | null;
  enRouteEtaMinutes?: number | null;
  report?: { clientVisible?: boolean } | null;
  property?: PropertyRef;
} | null | undefined;
export type EvidenceRef = { key: string; url: string };

/** The union of fields the Approvals page reads from any queue's record. */
export type ApprovalRecord = {
  id: string;
  jobId?: string | null;
  job?: JobRef;
  property?: PropertyRef;
  cleaner?: Person;
  requestedBy?: Person;
  qaUser?: Person;
  client?: { name?: string | null } | null;
  status?: string | null;
  title?: string | null;
  reason?: string | null;
  note?: string | null;
  notes?: string | null;
  description?: string | null;
  type?: string | null;
  category?: string | null;
  source?: string | null;
  requestType?: string | null;
  requestedTime?: string | null;
  requestedAmount?: number | null;
  requestedHours?: number | null;
  requestedRate?: number | null;
  primaryDisplayAmount?: number | null;
  clientRequestedAmount?: number | null;
  cleanerRequestedAmount?: number | null;
  approvedAmount?: number | null;
  amount?: number | null;
  currency?: string | null;
  counterAmount?: number | null;
  counterNote?: string | null;
  totalAmount?: number | null;
  minutesFromCleaner?: number | null;
  amountFromCleaner?: number | null;
  requestedDurationM?: number | null;
  requestedTotalDurationM?: number | null;
  originalDurationM?: number | null;
  score?: number | null;
  rawScore?: number | null;
  severity?: string | null;
  jobNumber?: string | number | null;
  jobType?: string | null;
  clientName?: string | null;
  scheduledDate?: string | null;
  startTime?: string | null;
  cleanSkipReason?: string | null;
  cleanSkipAt?: string | null;
  requestedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  paidClaimedAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  jobCount?: number | null;
  review?: { score?: number | null; passed?: boolean; kind?: string; createdAt?: string | null; cleanerAcknowledgedAt?: string | null } | null;
  cleaners?: string[];
  metadata?: Record<string, unknown> | null;
  attachmentUrls?: EvidenceRef[];
  paidClaimedProofUrls?: EvidenceRef[];
  clientApproval?: { status?: string | null } | null;
  [key: string]: unknown;
};

export type AllApprovalsResponse = Record<ApprovalsQueueKey, ApprovalRecord[]> & {
  bookingAvailability: Record<string, BookingAvailability | undefined>;
  counts: Partial<Record<ApprovalsQueueKey | "total", number>>;
};

export type BookingAvailability = { freeCleaners: number; activeCleaners: number; jobsScheduled: number; unassignedJobs: number };

export type ApprovalTypeChip = { key: string; label: string };

export type ApprovalQueueRow = {
  queue: ApprovalsQueueKey;
  id: string;
  record: ApprovalRecord;
  who: string;
  jobId: string | null;
  jobLabel: string | null;
  propertyName: string | null;
  type: ApprovalTypeChip;
  typeDetail: string | null;
  asked: string | null;
  /** Money asked, for sorting and the decision button. Null when not money. */
  askedAmount: number | null;
  waitingSince: string | null;
  hasEvidence: boolean;
  search: string;
};

function nameOf(person: Person, fallback: string): string {
  return person?.name || person?.email || fallback;
}

export function money(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const sign = amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function minutesText(mins: number | null | undefined): string | null {
  if (mins == null || !Number.isFinite(mins)) return null;
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return h <= 0 ? `${m} min` : `${h} h ${m} min`;
}

export function payAskedAmount(record: ApprovalRecord): number {
  return Number(record.primaryDisplayAmount ?? record.clientRequestedAmount ?? record.cleanerRequestedAmount ?? record.requestedAmount ?? 0);
}

function payType(record: ApprovalRecord): ApprovalTypeChip {
  if (record.category === "PARKING") return { key: "parking", label: "Parking" };
  if (record.category === "REIMBURSEMENT") return { key: "reimbursement", label: "Reimbursements" };
  if (record.type === "HOURLY") return { key: "time", label: "Extra time" };
  return { key: "fixed", label: "Fixed amount" };
}

function jobFields(record: ApprovalRecord): Pick<ApprovalQueueRow, "jobId" | "jobLabel" | "propertyName"> {
  const job = record.job;
  const jobId = record.jobId ?? job?.id ?? null;
  const number = job?.jobNumber ?? record.jobNumber ?? null;
  return {
    jobId,
    jobLabel: number != null ? `J-${number}` : null,
    propertyName: job?.property?.name ?? record.property?.name ?? null,
  };
}

const SINGLE_TYPE: Partial<Record<ApprovalsQueueKey, string>> = {
  continuations: "Continuation",
  flaggedLaundry: "Flagged laundry",
  rescheduleRequests: "Reschedule",
  skipRequests: "Skip clean",
  qaReworkTransfers: "Rework transfer",
  qaOutcomes: "QA outcome",
  falseConfirmations: "False confirmation",
  managementReviews: "Management review",
  cleanerInvoicePayClaims: "Payment claim",
};

/** Build the table row for one record. Pure; exported for tests. */
export function toQueueRow(queue: ApprovalsQueueKey, record: ApprovalRecord): ApprovalQueueRow {
  const base = jobFields(record);
  let who = nameOf(record.cleaner ?? record.requestedBy, "—");
  let type: ApprovalTypeChip = { key: queue, label: SINGLE_TYPE[queue] ?? queue };
  let typeDetail: string | null = null;
  let asked: string | null = null;
  let askedAmount: number | null = null;
  let waitingSince = record.requestedAt ?? record.createdAt ?? null;
  let hasEvidence = false;

  switch (queue) {
    case "payAdjustments": {
      type = payType(record);
      askedAmount = payAskedAmount(record);
      asked = money(askedAmount);
      hasEvidence = (record.attachmentUrls?.length ?? 0) > 0;
      typeDetail = hasEvidence ? "Receipt" : "No proof";
      if (record.clientApproval?.status === "PENDING") typeDetail = "Awaiting client";
      break;
    }
    case "rectificationAdjustments":
    case "bonusProposals": {
      type = { key: queue, label: String(record.source ?? (queue === "bonusProposals" ? "Bonus" : "Rectification")).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) };
      askedAmount = Number(record.requestedAmount ?? 0);
      asked = money(askedAmount);
      hasEvidence = true;
      break;
    }
    case "timeAdjustments": {
      type = { key: queue, label: "Clock fix" };
      asked = minutesText(record.requestedDurationM ?? record.requestedTotalDurationM ?? null);
      typeDetail = record.reason ?? null;
      waitingSince = record.createdAt ?? null;
      break;
    }
    case "timingRequests": {
      type = { key: String(record.requestType ?? "timing"), label: record.requestType === "EARLY_CHECKIN" ? "Early check-in" : "Late checkout" };
      asked = record.requestedTime ?? null;
      hasEvidence = true;
      break;
    }
    case "clientApprovals": {
      who = record.client?.name ?? "Client";
      type = { key: String(record.status ?? "PENDING"), label: record.status === "COUNTERED" ? "Counter-offer" : "Approval" };
      typeDetail = record.title ?? null;
      askedAmount = Number(record.status === "COUNTERED" ? record.counterAmount ?? 0 : record.amount ?? 0);
      asked = money(askedAmount);
      hasEvidence = record.status !== "COUNTERED";
      break;
    }
    case "clientRequests": {
      const kind = String(record.metadata?.requestType ?? "UPDATE");
      type = { key: kind, label: kind === "ETA" ? "ETA" : kind === "REPORT" ? "Report" : "Update" };
      typeDetail = typeof record.metadata?.note === "string" ? record.metadata.note : null;
      waitingSince = record.createdAt ?? null;
      break;
    }
    case "rescheduleRequests": {
      const requested = typeof record.metadata?.requestedDate === "string" ? record.metadata.requestedDate.slice(0, 10) : null;
      asked = requested;
      waitingSince = record.createdAt ?? null;
      hasEvidence = true;
      break;
    }
    case "skipRequests":
      typeDetail = record.cleanSkipReason ?? null;
      waitingSince = record.cleanSkipAt ?? null;
      break;
    case "bookingRequests":
      who = record.clientName ?? "Client";
      type = { key: queue, label: String(record.jobType ?? "Clean").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) };
      asked = record.scheduledDate ?? null;
      waitingSince = record.createdAt ?? null;
      break;
    case "qaReworkTransfers":
      askedAmount = Number(record.amountFromCleaner ?? 0);
      asked = `${money(askedAmount)} · ${record.minutesFromCleaner ?? 0} min`;
      typeDetail = record.qaUser?.name ? `To ${record.qaUser.name}` : null;
      waitingSince = record.createdAt ?? null;
      hasEvidence = true;
      break;
    case "qaOutcomes":
      who = record.cleaners?.length ? record.cleaners.join(", ") : "—";
      asked = record.review?.score != null ? `${Number(record.review.score).toFixed(0)}%` : null;
      waitingSince = record.review?.createdAt ?? null;
      hasEvidence = true;
      break;
    case "falseConfirmations":
      typeDetail = [record.severity, record.category].filter(Boolean).join(" · ") || null;
      waitingSince = record.createdAt ?? null;
      break;
    case "managementReviews":
      asked = record.score != null ? `${Number(record.score).toFixed(0)}%` : null;
      waitingSince = record.createdAt ?? null;
      break;
    case "cleanerInvoicePayClaims":
      askedAmount = Number(record.totalAmount ?? 0);
      asked = money(askedAmount);
      waitingSince = record.paidClaimedAt ?? null;
      typeDetail = (record.paidClaimedProofUrls?.length ?? 0) > 0 ? "Receipt" : "No proof";
      break;
    case "flaggedLaundry":
      typeDetail = typeof record.bagLocation === "string" ? `Bag: ${record.bagLocation}` : null;
      waitingSince = record.updatedAt ?? null;
      break;
    case "continuations":
      typeDetail = record.reason ?? null;
      break;
  }

  const search = [who, base.jobLabel, base.propertyName, type.label, typeDetail, record.title].filter(Boolean).join(" ").toLowerCase();
  return { queue, id: record.id, record, who, ...base, type, typeDetail, asked, askedAmount, waitingSince, hasEvidence, search };
}

export function rowsForQueue(data: AllApprovalsResponse, queue: ApprovalsQueueKey): ApprovalQueueRow[] {
  return (data[queue] ?? []).map((record) => toQueueRow(queue, record));
}

export function allRows(data: AllApprovalsResponse): ApprovalQueueRow[] {
  return APPROVAL_QUEUE_ORDER.flatMap((queue) => rowsForQueue(data, queue));
}

/** Milliseconds a request has waited, or null when its start is unknown. */
export function waitedMs(row: Pick<ApprovalQueueRow, "waitingSince">, now: number): number | null {
  if (!row.waitingSince) return null;
  const started = new Date(row.waitingSince).getTime();
  return Number.isNaN(started) ? null : Math.max(0, now - started);
}

export function waitingLabel(ms: number | null): string {
  if (ms == null) return "—";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export const DAY_MS = 86_400_000;

export type WaitingOrder = "oldest" | "newest";

/** Order rows by how long they have waited; unknown starts go last. */
export function sortByWaiting(rows: ApprovalQueueRow[], order: WaitingOrder): ApprovalQueueRow[] {
  return [...rows].sort((a, b) => {
    const at = a.waitingSince ? new Date(a.waitingSince).getTime() : Number.NaN;
    const bt = b.waitingSince ? new Date(b.waitingSince).getTime() : Number.NaN;
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return order === "oldest" ? at - bt : bt - at;
  });
}

/** Type chips with real counts for the loaded rows of one queue. */
export function typeChips(rows: ApprovalQueueRow[]): Array<ApprovalTypeChip & { count: number }> {
  const map = new Map<string, ApprovalTypeChip & { count: number }>();
  for (const row of rows) {
    const existing = map.get(row.type.key);
    if (existing) existing.count += 1;
    else map.set(row.type.key, { ...row.type, count: 1 });
  }
  return Array.from(map.values());
}
