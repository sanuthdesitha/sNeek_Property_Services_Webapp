/**
 * The job page's eight-step stage bar: Booked → Assigned → En route →
 * In progress → Submitted, review → Completed → Invoiced → Paid.
 *
 * Mapped from stored state, per the EStageBar rule: the current stage comes
 * from the job's status; a stage behind it is "done" only when a record shows
 * it happened (an assignment, a time log, a submission, a completion date, a
 * live invoice line, a payment date) and "passed" otherwise. A cancelled job
 * keeps the strip with every stage struck through, as drawn.
 */
import type { EStage, EStageState } from "@/components/v2/ui/stage-bar";

export const JOB_STAGE_KEYS = ["booked", "assigned", "en-route", "in-progress", "review", "completed", "invoiced", "paid"] as const;
export type JobStageKey = (typeof JOB_STAGE_KEYS)[number];

const LABELS: Record<JobStageKey, string> = {
  booked: "Booked",
  assigned: "Assigned",
  "en-route": "En route",
  "in-progress": "In progress",
  review: "Submitted, review",
  completed: "Completed",
  invoiced: "Invoiced",
  paid: "Paid",
};

/** Which stage each status sits at. */
const STATUS_STAGE: Record<string, JobStageKey> = {
  UNASSIGNED: "booked",
  OFFERED: "booked",
  ASSIGNED: "assigned",
  EN_ROUTE: "en-route",
  IN_PROGRESS: "in-progress",
  PAUSED: "in-progress",
  WAITING_CONTINUATION_APPROVAL: "in-progress",
  SUBMITTED: "review",
  QA_REVIEW: "review",
  COMPLETED: "completed",
  INVOICED: "invoiced",
};

const STATUS_NOTE: Record<string, string> = {
  OFFERED: "Offered",
  PAUSED: "Paused",
  WAITING_CONTINUATION_APPROVAL: "Awaiting approval",
  QA_REVIEW: "QA review",
};

export type JobStageFacts = {
  status: string;
  hasAssignment: boolean;
  hasTimeLog: boolean;
  hasSubmission: boolean;
  completedAt: Date | string | null;
  /** A line on a live invoice (lib/invoicing/invoiced-job-rule). */
  hasLiveInvoiceLine: boolean;
  /** The live invoice's status, when there is one (PAID, PART_PAID, …). */
  liveInvoiceStatus: string | null;
};

function recorded(key: JobStageKey, facts: JobStageFacts): boolean {
  switch (key) {
    case "booked":
      return true;
    case "assigned":
      return facts.hasAssignment;
    case "en-route":
      // Leaving for the job leaves no record of its own; a time log proves
      // the cleaner arrived, so it stands in for this step.
      return facts.hasTimeLog;
    case "in-progress":
      return facts.hasTimeLog;
    case "review":
      return facts.hasSubmission;
    case "completed":
      return facts.completedAt !== null;
    case "invoiced":
      return facts.hasLiveInvoiceLine;
    case "paid":
      return facts.liveInvoiceStatus === "PAID";
  }
}

export function jobStages(facts: JobStageFacts): EStage[] {
  if (facts.status === "CANCELLED") {
    return JOB_STAGE_KEYS.map((key) => ({ key, label: LABELS[key], state: "skipped" as EStageState }));
  }
  const paid = facts.liveInvoiceStatus === "PAID";
  const currentKey: JobStageKey | null = paid ? "paid" : STATUS_STAGE[facts.status] ?? null;
  const currentIndex = currentKey ? JOB_STAGE_KEYS.indexOf(currentKey) : -1;
  return JOB_STAGE_KEYS.map((key, index) => {
    let state: EStageState;
    let note: string | null = null;
    if (index === currentIndex) {
      state = "current";
      note = STATUS_NOTE[facts.status] ?? null;
    } else if (index < currentIndex) {
      state = recorded(key, facts) ? "done" : "passed";
    } else if (key === "paid" && facts.liveInvoiceStatus === "PART_PAID") {
      state = "pending";
      note = "Part paid";
    } else {
      state = "todo";
    }
    return { key, label: LABELS[key], state, note };
  });
}
