import { STATUS_LABELS } from "./status-labels";

export type StatusTone =
  | "warning"
  | "primary"
  | "info"
  | "danger"
  | "aubergine"
  | "success"
  | "gold"
  | "neutral";
export const JOB_STATUS_TONES: Record<string, StatusTone> = {
  UNASSIGNED: "warning",
  OFFERED: "warning",
  ASSIGNED: "primary",
  EN_ROUTE: "info",
  IN_PROGRESS: "info",
  PAUSED: "warning",
  WAITING_CONTINUATION_APPROVAL: "danger",
  SUBMITTED: "aubergine",
  QA_REVIEW: "aubergine",
  COMPLETED: "success",
  INVOICED: "gold",
};
export const LAUNDRY_STATUS_TONES: Record<string, StatusTone> = {
  PENDING: "neutral",
  CONFIRMED: "primary",
  PICKED_UP: "info",
  DROPPED: "success",
  FLAGGED: "danger",
  SKIPPED_PICKUP: "warning",
};

/** Subtle whole-block colour; visible text labels remain the primary indicator. */
export function statusBlockStyle(
  status: string,
  domain: "job" | "laundry" = "job",
) {
  const tone =
    (domain === "job" ? JOB_STATUS_TONES : LAUNDRY_STATUS_TONES)[status] ??
    "neutral";
  const fallback: Record<StatusTone, string> = {
    warning: "36 74% 38%",
    primary: "158 42% 20%",
    info: "205 39% 38%",
    danger: "5 58% 42%",
    aubergine: "284 22% 44%",
    success: "150 40% 35%",
    gold: "41 42% 57%",
    neutral: "160 5% 48%",
  };
  const token = tone === "neutral" ? "muted-foreground" : tone;
  return {
    backgroundColor: `hsl(var(--e-${token}, ${fallback[tone]}) / 0.08)`,
    borderInlineStart: `3px solid hsl(var(--e-${token}, ${fallback[tone]}) / 0.65)`,
  };
}

export const JOB_PROGRESS_STEPS = [
  "Planning",
  "Assigned",
  "On the way",
  "Cleaning",
  "Review",
  "Completed",
  "Invoiced",
];
const steps: Record<string, number> = {
  UNASSIGNED: 0,
  OFFERED: 0,
  ASSIGNED: 1,
  EN_ROUTE: 2,
  IN_PROGRESS: 3,
  PAUSED: 3,
  WAITING_CONTINUATION_APPROVAL: 3,
  SUBMITTED: 4,
  QA_REVIEW: 4,
  COMPLETED: 5,
  INVOICED: 6,
};
export function jobProgress(status: string) {
  const step = steps[status];
  return {
    step: step ?? null,
    label: STATUS_LABELS[status] ?? status.replace(/_/g, " "),
  };
}
