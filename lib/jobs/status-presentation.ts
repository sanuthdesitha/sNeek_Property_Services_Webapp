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
  CANCELLED: "neutral",
};
export const LAUNDRY_STATUS_TONES: Record<string, StatusTone> = {
  PENDING: "neutral",
  CONFIRMED: "primary",
  PICKED_UP: "info",
  READY_TO_RETURN: "info",
  DROPPED: "success",
  FLAGGED: "danger",
  SKIPPED_PICKUP: "warning",
};

/** Subtle whole-block colour; visible text labels remain the primary indicator. */
const STATUS_TONE_FALLBACK: Record<StatusTone, string> = {
  warning: "36 74% 38%",
  primary: "158 42% 20%",
  info: "205 39% 38%",
  danger: "5 58% 42%",
  aubergine: "284 22% 44%",
  success: "150 40% 35%",
  gold: "41 42% 57%",
  neutral: "160 5% 48%",
};

function statusToneColor(status: string, domain: "job" | "laundry"): string {
  const tone =
    (domain === "job" ? JOB_STATUS_TONES : LAUNDRY_STATUS_TONES)[status] ??
    "neutral";
  const token = tone === "neutral" ? "muted-foreground" : tone;
  return `var(--e-${token}, ${STATUS_TONE_FALLBACK[tone]})`;
}

/**
 * Classic (v1) status block: tint plus a coloured inline-start edge. The v2
 * app must not use it — the owner removed coloured left lines there; use
 * {@link statusTintStyle} instead (tests/lib/no-left-accent-lines.test.ts).
 */
export function statusBlockStyle(
  status: string,
  domain: "job" | "laundry" = "job",
) {
  const color = statusToneColor(status, domain);
  return {
    backgroundColor: `hsl(${color} / 0.08)`,
    borderInlineStart: `3px solid hsl(${color} / 0.65)`,
  };
}

/** v2 status block: the same soft status tint, no coloured edge line. */
export function statusTintStyle(
  status: string,
  domain: "job" | "laundry" = "job",
) {
  return { backgroundColor: `hsl(${statusToneColor(status, domain)} / 0.08)` };
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
