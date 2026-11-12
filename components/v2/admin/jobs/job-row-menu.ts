/**
 * The "more" menu of a Jobs row or board card. The row keeps one visible
 * action (Assign, when nobody is on the job); everything else is here. Each
 * item only starts an existing flow: the detail page's tabs, the reviewed
 * bulk-status change for one job, or the bulk reminder for one job.
 */
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import { jobDetailTabHref } from "@/lib/jobs/detail-tabs";
import { REMINDABLE_JOB_STATUSES } from "./jobs-constants";
import type { JobListRow } from "./jobs-query";

export type JobRowHandlers = {
  onPreview: (job: JobListRow) => void;
  onChangeStatus: (job: JobListRow) => void;
  onRemind: (job: JobListRow) => void;
  /** Opens the cancel dialog (reason required; the server decides the rules). */
  onCancel: (job: JobListRow) => void;
};

export function jobRowMenuItems(job: JobListRow, handlers: JobRowHandlers, readOnly: boolean): ERowMenuItem[] {
  const remindable = (REMINDABLE_JOB_STATUSES as readonly string[]).includes(job.status);
  return [
    { key: "preview", label: "Preview", onSelect: () => handlers.onPreview(job) },
    { key: "open", label: "Open full job", href: `/v2/admin/jobs/${job.id}` },
    { key: "manage", label: "Manage schedule", href: jobDetailTabHref(job.id, "schedule") },
    { key: "people", label: "People and assignment", href: jobDetailTabHref(job.id, "people") },
    { key: "messages", label: "Client messages", href: `${jobDetailTabHref(job.id, "messages")}#chat` },
    {
      key: "status",
      label: "Change status…",
      separated: true,
      onSelect: () => handlers.onChangeStatus(job),
      disabled: readOnly || job.status === "INVOICED" || job.status === "CANCELLED",
      hint: job.status === "INVOICED" ? "Invoiced jobs are locked." : job.status === "CANCELLED" ? "Cancelled jobs come back through Restore." : readOnly ? "Read-only access." : undefined,
    },
    {
      key: "remind",
      label: "Send reminder…",
      onSelect: () => handlers.onRemind(job),
      disabled: !remindable,
      hint: remindable ? undefined : "Only paused, in-progress or submitted jobs can be reminded.",
    },
    job.status === "CANCELLED"
      ? { key: "restore", label: "Restore…", onSelect: () => handlers.onPreview(job), disabled: readOnly, hint: readOnly ? "Read-only access." : undefined }
      : {
          key: "cancel",
          label: "Cancel job…",
          separated: true,
          onSelect: () => handlers.onCancel(job),
          disabled: readOnly || job.status === "INVOICED",
          hint: job.status === "INVOICED" ? "Invoiced jobs cannot be cancelled." : readOnly ? "Read-only access." : undefined,
        },
  ];
}
