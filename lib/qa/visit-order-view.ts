/**
 * QA Today: the visit order rows (approved board "QA portal", screen 1).
 *
 * Presentation of what `GET /api/qa/queue` already returns, in the order the
 * day planner stored (sequence, then planned slot, then due time). Readiness
 * comes from the existing queue stage; pay goes through the same pure
 * calculator the server and payroll use, and a missing rate says so instead of
 * showing $0.00. Plain module: no React, no "use client".
 */
import { computeQaAssignmentPay, type QaPaySettingsInput } from "@/lib/finance/qa-pay";
import { qaQueueReadiness, qaQueueStage, type QaQueueStage } from "@/lib/qa/queue-readiness";

const TZ = "Australia/Sydney";

/** The parts of a queue assignment this view reads. */
export interface QueueAssignmentInput {
  id: string;
  jobId: string;
  status?: string | null;
  sequence?: number | null;
  scheduledFor?: string | null;
  checkInSkippedReason?: string | null;
  payMode?: string | null;
  payAmount?: number | null;
  payHourlyRate?: number | null;
  payHoursAllocated?: number | null;
  onSiteMinutes?: number | null;
  paySettledAmount?: number | null;
  assignedTo?: { id: string; hourlyRate?: number | null } | null;
  inspectionReadiness?: string | null;
  job?: {
    status?: string | null;
    isRework?: boolean | null;
    inspectionReadiness?: string | null;
    dueTime?: string | null;
    property?: { name?: string | null; suburb?: string | null } | null;
    assignments?: { user?: { name?: string | null; email?: string | null } | null }[];
    formSubmissions?: { createdAt?: string | null }[];
  } | null;
}

export type VisitReadinessTone = "success" | "warning" | "info" | "neutral" | "danger";

export interface VisitOrderRow {
  assignmentId: string;
  jobId: string;
  position: number;
  property: string;
  /** "13:30 · Marco R. submitted 12:41" style line, built from recorded facts only. */
  detail: string;
  readiness: { label: string; tone: VisitReadinessTone };
  stage: QaQueueStage;
  /** True while the clean has not been submitted: starting needs a reason. */
  waitingForCleaner: boolean;
  pay: string;
  assignedToId: string | null;
}

function hhmm(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString("en-AU", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

function money(amount: number): string {
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const READINESS: Record<QaQueueStage, { label: string; tone: VisitReadinessTone }> = {
  READY: { label: "Ready", tone: "success" },
  PLANNED: { label: "Ready", tone: "success" },
  WAITING: { label: "Wait", tone: "warning" },
  INSPECTING: { label: "Inspecting", tone: "info" },
  COMPLETED: { label: "Done", tone: "neutral" },
  BLOCKED: { label: "Blocked", tone: "danger" },
};

/** The pay line for one planned inspection. Never "$0.00" for an unset rate. */
export function visitPayLabel(assignment: QueueAssignmentInput, settings: QaPaySettingsInput | null): string {
  if (assignment.paySettledAmount != null) return money(Number(assignment.paySettledAmount));
  if (!settings) return "Pay shown on the inspection";
  const pay = computeQaAssignmentPay({
    assignment,
    inspector: { hourlyRate: assignment.assignedTo?.hourlyRate ?? null },
    settings,
  });
  if (pay.rateMissing) return "Rate not set · office to fix";
  if (pay.mode === "NONE") return "Unpaid inspection";
  if (pay.mode === "FIXED") return money(pay.amount);
  return `${money(pay.rate)}/h`;
}

function cleanerLine(assignment: QueueAssignmentInput, stage: QaQueueStage): string | null {
  const job = assignment.job;
  const cleaner = job?.assignments?.map((entry) => entry.user?.name || entry.user?.email).filter(Boolean)[0] ?? null;
  const submittedAt = hhmm(job?.formSubmissions?.[0]?.createdAt ?? null);
  if (stage === "WAITING") {
    const readiness = qaQueueReadiness(job ?? null);
    const waitingOn = readiness === "REWORK_PENDING" ? "rework in progress" : "cleaning now · form pending";
    return cleaner ? `${cleaner} ${waitingOn}` : waitingOn;
  }
  if (submittedAt) return cleaner ? `${cleaner} submitted ${submittedAt}` : `submitted ${submittedAt}`;
  return cleaner;
}

export function buildVisitOrderRows(
  assignments: readonly QueueAssignmentInput[],
  settings: QaPaySettingsInput | null,
): VisitOrderRow[] {
  return assignments.map((assignment, index) => {
    const { stage } = qaQueueStage(
      assignment.job ? { ...assignment.job, inspectionReadiness: assignment.inspectionReadiness ?? assignment.job.inspectionReadiness } : null,
      assignment,
    );
    const slot = hhmm(assignment.scheduledFor) ?? assignment.job?.dueTime ?? null;
    const remote = assignment.checkInSkippedReason ? "Remote review" : null;
    const detail = [slot, remote, cleanerLine(assignment, stage)].filter(Boolean).join(" · ");
    return {
      assignmentId: assignment.id,
      jobId: assignment.jobId,
      position: index + 1,
      property: assignment.job?.property?.name || "Property",
      detail: detail || "No time planned",
      readiness: READINESS[stage],
      stage,
      waitingForCleaner: stage === "WAITING",
      pay: visitPayLabel(assignment, settings),
      assignedToId: assignment.assignedTo?.id ?? null,
    };
  });
}

/** The next stop to start: the first row not yet done. */
export function nextVisit(rows: readonly VisitOrderRow[]): VisitOrderRow | null {
  return rows.find((row) => row.stage !== "COMPLETED" && row.stage !== "BLOCKED") ?? null;
}

/** Swap a row with its neighbour; returns null when the move is not possible. */
export function moveVisit(rows: readonly VisitOrderRow[], index: number, delta: -1 | 1): VisitOrderRow[] | null {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= rows.length) return null;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((row, position) => ({ ...row, position: position + 1 }));
}
