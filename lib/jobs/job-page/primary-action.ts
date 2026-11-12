/**
 * The admin job page's header actions (design "Job full view", 2026-11).
 *
 * One rule decides the primary button: the next thing a person must do at
 * this status. Everything else is a secondary button or sits in the "More"
 * menu (./more-menu.ts). Pure, so the table is tested on its own and the
 * server page and the client header read the same answer.
 *
 * Every action here only STARTS something that already exists (an anchor on
 * the page, an existing dialog or route). No action changes a business rule.
 */
import { STATUS_LABELS } from "@/lib/jobs/status-labels";

export type JobPageStatus =
  | "UNASSIGNED"
  | "OFFERED"
  | "ASSIGNED"
  | "EN_ROUTE"
  | "IN_PROGRESS"
  | "PAUSED"
  | "WAITING_CONTINUATION_APPROVAL"
  | "SUBMITTED"
  | "QA_REVIEW"
  | "COMPLETED"
  | "INVOICED"
  | "CANCELLED";

export type JobPrimaryActionKind =
  | "assign"
  | "message-team"
  | "review-continuation"
  | "review-submission"
  | "open-quality"
  | "open-invoice"
  | "restore";

/** Status → primary action, the table drawn on the "four states" board. */
export const PRIMARY_ACTION_BY_STATUS: Record<JobPageStatus, JobPrimaryActionKind> = {
  UNASSIGNED: "assign",
  OFFERED: "assign",
  ASSIGNED: "message-team",
  EN_ROUTE: "message-team",
  IN_PROGRESS: "message-team",
  PAUSED: "message-team",
  WAITING_CONTINUATION_APPROVAL: "review-continuation",
  SUBMITTED: "review-submission",
  QA_REVIEW: "open-quality",
  COMPLETED: "open-invoice",
  INVOICED: "open-invoice",
  CANCELLED: "restore",
};

export type JobLiveInvoice = { id: string; invoiceNumber: string | null };

export type JobPrimaryAction = {
  kind: JobPrimaryActionKind;
  label: string;
  /** Where the action goes when it is a link (an anchor on the page or a route). */
  href: string | null;
  /** Set when the action does not apply yet; the button stays visible, disabled, with this reason. */
  disabledReason: string | null;
};

export type JobPrimaryActionInput = {
  jobId: string;
  status: string;
  liveInvoice: JobLiveInvoice | null;
  /** From restoreRefusal(); null when the job can be restored. */
  restoreRefusal: string | null;
  readOnly: boolean;
};

export const VIEW_ONLY_REASON = "View only: your Jobs access does not allow changes.";

export function isJobPageStatus(value: string): value is JobPageStatus {
  return Object.prototype.hasOwnProperty.call(PRIMARY_ACTION_BY_STATUS, value);
}

export function messagesHref(jobId: string): string {
  return `/v2/admin/jobs/${encodeURIComponent(jobId)}?view=messages#chat`;
}

/** The single primary action for the job's status. Unknown statuses get none. */
export function primaryActionFor(input: JobPrimaryActionInput): JobPrimaryAction | null {
  if (!isJobPageStatus(input.status)) return null;
  const kind = PRIMARY_ACTION_BY_STATUS[input.status];
  switch (kind) {
    case "assign":
      return {
        kind,
        label: "Assign cleaner",
        href: "#s-dispatch",
        disabledReason: input.readOnly ? VIEW_ONLY_REASON : null,
      };
    case "message-team":
      // The job chat is client↔office only (policy), so messaging the team
      // opens the office compose workspace.
      return { kind, label: "Message team", href: "/v2/admin/messages/compose", disabledReason: null };
    case "review-continuation":
      return { kind, label: "Review continuation request", href: "#s-site", disabledReason: null };
    case "review-submission":
      return { kind, label: "Review and approve", href: "#s-submitted", disabledReason: null };
    case "open-quality":
      return { kind, label: "Open quality check", href: "#s-qa", disabledReason: null };
    case "open-invoice": {
      const invoice = input.liveInvoice;
      if (!invoice) {
        return { kind, label: "Open invoice", href: null, disabledReason: "Not invoiced yet. The job goes on the client's next invoice run." };
      }
      return {
        kind,
        label: invoice.invoiceNumber ? `Open invoice ${invoice.invoiceNumber}` : "Open invoice",
        href: `/v2/admin/finance/invoices/${encodeURIComponent(invoice.id)}`,
        disabledReason: null,
      };
    }
    case "restore":
      return {
        kind,
        label: "Restore job",
        href: null,
        disabledReason: input.readOnly ? VIEW_ONLY_REASON : input.restoreRefusal,
      };
  }
}

export type JobSecondaryActionKind = "message-client" | "send-back" | "send-reminder" | "share-report";

export type JobSecondaryAction = {
  kind: JobSecondaryActionKind;
  label: string;
  href: string | null;
  disabledReason: string | null;
};

export type ReminderEligibility = { eligible: boolean; reason: string | null };

export const REMINDER_STALE_MS = 24 * 60 * 60 * 1000;
export const REMINDER_CONDITION = "Paused or 24 h+";

/**
 * "Send reminder" is offered when the job is PAUSED, or has been IN_PROGRESS
 * for more than 24 hours (running since the earliest open time log, else the
 * latest log) — the rule the page has always used.
 */
export function reminderEligibility(input: { status: string; runningSince: Date | null; now: Date }): ReminderEligibility {
  if (input.status === "PAUSED") return { eligible: true, reason: null };
  if (input.status === "IN_PROGRESS" && input.runningSince && input.now.getTime() - input.runningSince.getTime() > REMINDER_STALE_MS) {
    return { eligible: true, reason: null };
  }
  return { eligible: false, reason: "Offered when the job is paused or has been running for over 24 hours." };
}

export type JobSecondaryInput = {
  jobId: string;
  status: string;
  reminder: ReminderEligibility;
  hasSubmission: boolean;
  readOnly: boolean;
};

/** Secondary header buttons, beside the primary, as drawn per state. */
export function secondaryActionsFor(input: JobSecondaryInput): JobSecondaryAction[] {
  const messages = messagesHref(input.jobId);
  const status = input.status;
  if (status === "CANCELLED") return [{ kind: "message-client", label: "Message client", href: messages, disabledReason: null }];
  if (status === "SUBMITTED" || status === "QA_REVIEW") {
    return [
      { kind: "message-client", label: "Message", href: messages, disabledReason: null },
      {
        kind: "send-back",
        label: "Send back for rework",
        href: null,
        disabledReason: input.readOnly ? VIEW_ONLY_REASON : null,
      },
    ];
  }
  if (status === "IN_PROGRESS" || status === "PAUSED") {
    return [
      {
        kind: "send-reminder",
        label: "Send reminder",
        href: null,
        disabledReason: input.readOnly ? VIEW_ONLY_REASON : input.reminder.reason,
      },
    ];
  }
  if (status === "COMPLETED" || status === "INVOICED") {
    return [
      {
        kind: "share-report",
        label: "Share report",
        href: "#s-report",
        disabledReason: input.hasSubmission ? null : "No submitted job form, so there is no report to share.",
      },
    ];
  }
  return [{ kind: "message-client", label: "Message", href: messages, disabledReason: null }];
}

export type JobStatusBadge = { label: string; tone: "neutral" | "gold" | "success" | "warning" | "danger" | "info" | "primary" };

/** The title badge, in the words and tones drawn on the boards. */
export function jobStatusBadge(status: string): JobStatusBadge {
  switch (status) {
    case "UNASSIGNED":
      return { label: "Unassigned", tone: "danger" };
    case "SUBMITTED":
      return { label: "Submitted, awaiting review", tone: "gold" };
    case "IN_PROGRESS":
      return { label: "In progress", tone: "info" };
    case "INVOICED":
      return { label: "Invoiced", tone: "success" };
    case "COMPLETED":
      return { label: "Completed", tone: "success" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "danger" };
    case "PAUSED":
    case "WAITING_CONTINUATION_APPROVAL":
    case "OFFERED":
      return { label: STATUS_LABELS[status], tone: "warning" };
    case "QA_REVIEW":
      return { label: STATUS_LABELS[status], tone: "gold" };
    default:
      return { label: STATUS_LABELS[status] ?? status.replace(/_/g, " ").toLowerCase(), tone: isJobPageStatus(status) ? "primary" : "neutral" };
  }
}
