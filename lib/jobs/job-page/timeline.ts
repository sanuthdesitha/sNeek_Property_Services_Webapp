/**
 * The job timeline: Booking → Scope → Dispatch → On site → Submitted →
 * Quality check → Report → Laundry → Invoice and pay.
 *
 * Each stage gets a state and a one-line headline from stored facts:
 *   done — it happened (a record shows it)
 *   now  — the job is at this stage (gold on the board); it carries its buttons
 *   todo — not yet (dashed "Not yet")
 * The sequential stages follow the status; Quality, Report and Laundry are
 * independent of it and use their own records. A cancelled job keeps every
 * recorded stage readable and has no current stage.
 */
import type { JobStageAnchor } from "./deep-link";

export const TIMELINE_STAGES = ["booking", "scope", "dispatch", "site", "submitted", "qa", "report", "laundry", "invoice"] as const;
export type TimelineStageKey = (typeof TIMELINE_STAGES)[number];
export type TimelineStageState = "done" | "now" | "todo";

export const STAGE_ANCHORS: Record<TimelineStageKey, JobStageAnchor> = {
  booking: "s-booking",
  scope: "s-scope",
  dispatch: "s-dispatch",
  site: "s-site",
  submitted: "s-submitted",
  qa: "s-qa",
  report: "s-report",
  laundry: "s-laundry",
  invoice: "s-invoice",
};

export const STAGE_LABELS: Record<TimelineStageKey, string> = {
  booking: "Booking",
  scope: "Scope",
  dispatch: "Dispatch",
  site: "On site",
  submitted: "Submitted",
  qa: "Quality check",
  report: "Report",
  laundry: "Laundry",
  invoice: "Invoice and pay",
};

/** The stage the job is at, by status (null when cancelled or unknown). */
const STATUS_NOW: Record<string, TimelineStageKey> = {
  UNASSIGNED: "dispatch",
  OFFERED: "dispatch",
  ASSIGNED: "dispatch",
  EN_ROUTE: "site",
  IN_PROGRESS: "site",
  PAUSED: "site",
  WAITING_CONTINUATION_APPROVAL: "site",
  SUBMITTED: "submitted",
  QA_REVIEW: "qa",
  COMPLETED: "invoice",
  INVOICED: "invoice",
};

const SEQUENTIAL: readonly TimelineStageKey[] = ["booking", "scope", "dispatch", "site", "submitted", "invoice"];

export type TimelineFacts = {
  status: string;
  hasAssignment: boolean;
  acceptedCount: number;
  assignmentCount: number;
  hasTimeLog: boolean;
  clockRunning: boolean;
  hasSubmission: boolean;
  hasQaReview: boolean;
  qaPassed: boolean | null;
  qaScore: number | null;
  qaInspectorName: string | null;
  reportExists: boolean;
  reportSent: boolean;
  laundry: { exists: boolean; supplierName: string | null; finished: boolean; notPlanned?: string | null };
  liveInvoice: { invoiceNumber: string | null; status: string } | null;
  formName: string | null;
  bookingSource: string | null;
  hasReservation: boolean;
  /** "09:28 – 12:40", or null when no time was logged. */
  siteWindow: string | null;
  runningSinceLabel: string | null;
  submittedLabel: string | null;
};

export type TimelineStage = {
  key: TimelineStageKey;
  anchor: JobStageAnchor;
  label: string;
  /** "1 · Booking". */
  eyebrow: string;
  state: TimelineStageState;
  headline: string;
};

function independentDone(key: TimelineStageKey, facts: TimelineFacts): boolean {
  if (key === "qa") return facts.hasQaReview;
  if (key === "report") return facts.reportExists || facts.reportSent;
  if (key === "laundry") return facts.laundry.finished;
  return false;
}

function sequentialDone(key: TimelineStageKey, facts: TimelineFacts): boolean {
  switch (key) {
    case "booking":
    case "scope":
      return true;
    case "dispatch":
      return facts.hasAssignment;
    case "site":
      return facts.hasTimeLog && !facts.clockRunning;
    case "submitted":
      return facts.hasSubmission;
    case "invoice":
      return facts.liveInvoice?.status === "PAID";
    default:
      return false;
  }
}

/**
 * A stage is "now" when the status puts the job there (a paid invoice is done,
 * not current); otherwise "done" only when its record exists. A stage the job
 * moved past without a record stays "todo" rather than claiming it happened.
 */
export function stageState(key: TimelineStageKey, facts: TimelineFacts): TimelineStageState {
  const nowKey = STATUS_NOW[facts.status] ?? null;
  const recorded = SEQUENTIAL.includes(key) ? sequentialDone(key, facts) : independentDone(key, facts);
  if (key === nowKey && !(key === "invoice" && recorded)) return "now";
  return recorded ? "done" : "todo";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function stageHeadline(key: TimelineStageKey, facts: TimelineFacts): string {
  switch (key) {
    case "booking":
      if (!facts.hasReservation) return "Booked by the office";
      return facts.bookingSource ? `From the ${facts.bookingSource} calendar` : "From the booking calendar";
    case "scope":
      return facts.formName ?? "Job scope and notes";
    case "dispatch":
      if (facts.assignmentCount === 0) return "No cleaner assigned";
      if (facts.acceptedCount === facts.assignmentCount) return `${plural(facts.acceptedCount, "cleaner")} accepted`;
      return `${facts.acceptedCount} of ${plural(facts.assignmentCount, "cleaner")} accepted`;
    case "site":
      if (facts.clockRunning && facts.runningSinceLabel) return `Clock running since ${facts.runningSinceLabel}`;
      return facts.siteWindow ?? "Not started";
    case "submitted":
      if (facts.status === "SUBMITTED") return "Needs your review";
      return facts.submittedLabel ?? "Not submitted yet";
    case "qa":
      if (facts.hasQaReview && facts.qaScore !== null) return `QA ${Math.round(facts.qaScore)}, ${facts.qaPassed ? "passed" : "failed"}`;
      return facts.qaInspectorName ? `Inspector: ${facts.qaInspectorName}` : "No QA inspector assigned";
    case "report":
      if (facts.reportSent) return "Report shared with the client";
      if (facts.reportExists) return "Report ready, not shared yet";
      return "Cleaning report not generated yet";
    case "laundry":
      if (!facts.laundry.exists && facts.laundry.notPlanned) return facts.laundry.notPlanned;
      if (!facts.laundry.exists) return "No laundry task for this job";
      return facts.laundry.supplierName ?? "Laundry task, no supplier recorded";
    case "invoice":
      if (!facts.liveInvoice) return "Not invoiced yet";
      return `${facts.liveInvoice.invoiceNumber ?? "Invoice"} · ${facts.liveInvoice.status.replace(/_/g, " ").toLowerCase()}`;
  }
}

export function buildTimeline(facts: TimelineFacts): TimelineStage[] {
  return TIMELINE_STAGES.map((key, index) => ({
    key,
    anchor: STAGE_ANCHORS[key],
    label: STAGE_LABELS[key],
    eyebrow: `${index + 1} · ${STAGE_LABELS[key]}`,
    state: stageState(key, facts),
    headline: stageHeadline(key, facts),
  }));
}
