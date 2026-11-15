/**
 * The job page's "More" menu: every job action that is not the primary or a
 * secondary button, in two labelled groups ("Job" and "Danger zone"), as drawn.
 *
 * Actions that do not apply yet stay visible but disabled, with the reason, so
 * nobody hunts for them. Each entry only starts an existing dialog or route;
 * confirmation, PIN and typed-phrase rules stay in those dialogs, and every
 * server route re-checks the same rules.
 */
import { STARTED_CANCELLABLE_STATUSES, isUnstartedStatus } from "@/lib/jobs/cancel-rules";
import { REMINDER_CONDITION, VIEW_ONLY_REASON, type ReminderEligibility } from "./primary-action";

export type JobMenuActionKey =
  | "edit-details"
  | "reschedule"
  | "change-status"
  | "skip"
  | "send-reminder"
  | "save-template"
  | "duplicate"
  | "download-report"
  | "open-live-ops"
  | "edit-clock"
  | "reset"
  | "cancel"
  | "delete";

export type JobMenuGroup = "job" | "danger";

export type JobMenuEntry = {
  key: JobMenuActionKey;
  label: string;
  group: JobMenuGroup;
  danger: boolean;
  /** Null when the action is available. */
  disabledReason: string | null;
  /** Short condition shown beside the label (e.g. when a reminder is offered). */
  badge: string | null;
  /** Set for entries that navigate instead of opening a dialog. */
  href: string | null;
};

export type JobMenuInput = {
  jobId: string;
  status: string;
  actorIsAdmin: boolean;
  readOnly: boolean;
  reminder: ReminderEligibility;
  hasSubmission: boolean;
  hasTimeLogs: boolean;
  /** Job.cleanSkipStatus: NONE | REQUESTED | SKIPPED. */
  skipStatus: string;
};

export const JOB_MENU_FOOTNOTE =
  "Delete asks for your PIN or password; Reset asks for it when it clears records. Restore appears in the header once a job is cancelled.";
export const CANCELLED_MENU_FOOTNOTE =
  "Delete asks for your PIN or password. Edit, Reschedule and Skip come back once the job is restored.";

const CLOCK_STATUSES = new Set(["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"]);

/** Why "Cancel job" is unavailable, or null. Mirrors cancelRefusal() without the reason check. */
export function cancelUnavailableReason(status: string, actorIsAdmin: boolean): string | null {
  if (status === "CANCELLED") return "This job is already cancelled.";
  if (status === "INVOICED") return "Invoiced jobs cannot be cancelled.";
  if (isUnstartedStatus(status)) return null;
  if ((STARTED_CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
    return actorIsAdmin ? null : "Only an administrator can cancel a job that has started.";
  }
  return "This job cannot be cancelled from its current status.";
}

function skipLabel(skipStatus: string): string {
  if (skipStatus === "REQUESTED") return "Review skip request";
  if (skipStatus === "SKIPPED") return "Restore skipped clean";
  return "Skip this clean";
}

function entry(
  key: JobMenuActionKey,
  label: string,
  group: JobMenuGroup,
  options: Partial<Pick<JobMenuEntry, "danger" | "disabledReason" | "badge" | "href">> = {},
): JobMenuEntry {
  return {
    key,
    label,
    group,
    danger: options.danger ?? false,
    disabledReason: options.disabledReason ?? null,
    badge: options.badge ?? null,
    href: options.href ?? null,
  };
}

/** The menu for one job, in display order. */
export function moreMenuFor(input: JobMenuInput): JobMenuEntry[] {
  const viewOnly = input.readOnly ? VIEW_ONLY_REASON : null;
  const noReport = input.hasSubmission ? null : "No submitted job form yet, so there is no report.";
  const deleteEntry = entry("delete", "Delete job…", "danger", { danger: true, disabledReason: viewOnly });

  if (input.status === "CANCELLED") {
    return [entry("download-report", "Download report", "job", { disabledReason: noReport }), deleteEntry];
  }

  const entries: JobMenuEntry[] = [
    entry("edit-details", "Edit job details", "job", { disabledReason: viewOnly }),
    entry("reschedule", "Reschedule or change times", "job", { disabledReason: viewOnly }),
    entry("change-status", "Change status…", "job", { disabledReason: viewOnly }),
    entry("skip", skipLabel(input.skipStatus), "job", { disabledReason: viewOnly }),
    entry("send-reminder", "Send reminder to cleaners", "job", {
      badge: REMINDER_CONDITION,
      disabledReason: viewOnly ?? input.reminder.reason,
    }),
    entry("save-template", "Save job as template", "job", { disabledReason: viewOnly }),
    entry("duplicate", "Duplicate", "job", {
      disabledReason: viewOnly,
      href: `/v2/admin/jobs/new?duplicate=${encodeURIComponent(input.jobId)}`,
    }),
    entry("download-report", "Download report", "job", { disabledReason: noReport }),
    entry("open-live-ops", "Open in Live ops", "job", { href: "/v2/admin/ops" }),
  ];
  if (input.hasTimeLogs || CLOCK_STATUSES.has(input.status)) {
    entries.push(
      entry("edit-clock", "Edit clock and GPS", "job", {
        href: `/v2/admin/jobs/${encodeURIComponent(input.jobId)}?view=clock`,
      }),
    );
  }
  entries.push(
    entry("reset", "Reset job…", "danger", { disabledReason: viewOnly }),
    entry("cancel", "Cancel job…", "danger", {
      danger: true,
      disabledReason: viewOnly ?? cancelUnavailableReason(input.status, input.actorIsAdmin),
    }),
    deleteEntry,
  );
  return entries;
}
