import { createHash } from "node:crypto";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { resolveAppUrl } from "@/lib/app-url";
import { getJobReference } from "@/lib/jobs/job-number";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import type { ReminderDigestJob } from "@/lib/email-design/reminder-digest";

/** The job fields a combined reminder lists. */
export type DigestSourceJob = {
  id: string;
  jobNumber?: string | null;
  jobType: string;
  scheduledDate: Date;
  startTime?: string | null;
  dueTime?: string | null;
  endTime?: string | null;
  internalNotes?: string | null;
  property: { name: string; address: string | null };
};

const TIME_PATTERN = /^\d{2}:\d{2}$/;

/** The job's start in the organisation's timezone (same rule the reminder windows use). */
export function digestStartsAt(job: DigestSourceJob, timezone: string, defaultTime: string): Date {
  const datePart = format(toZonedTime(job.scheduledDate, timezone), "yyyy-MM-dd");
  const timeValue = job.startTime || job.dueTime || job.endTime || defaultTime;
  const safeTime = TIME_PATTERN.test(timeValue) ? timeValue : defaultTime;
  return fromZonedTime(`${datePart}T${safeTime}:00`, timezone);
}

/** One row of a combined reminder: the facts and timing lines the per-job reminder carries, plus the job's link. */
export function toDigestJob(job: DigestSourceJob, input: { timezone: string; defaultTime: string; timeLabel?: string; priorityLines?: string[] }): ReminderDigestJob {
  return {
    jobId: job.id,
    jobReference: getJobReference(job),
    propertyName: job.property.name,
    propertyAddress: job.property.address ?? "",
    jobTypeLabel: job.jobType.replace(/_/g, " "),
    dayLabel: format(toZonedTime(job.scheduledDate, input.timezone), "EEE d MMM"),
    timeLabel: input.timeLabel ?? job.startTime ?? "Time TBD",
    timingLines: getJobTimingHighlights(parseJobInternalNotes(job.internalNotes ?? null)),
    ...(input.priorityLines?.length ? { priorityLines: input.priorityLines } : {}),
    jobUrl: resolveAppUrl(`/cleaner/jobs/${encodeURIComponent(job.id)}`),
    sortAt: digestStartsAt(job, input.timezone, input.defaultTime).getTime(),
  };
}

/**
 * The safeguard subject of a combined reminder email: one key for this
 * recipient and this set of jobs (the same set gives the same key). The jobs
 * themselves go to the gate as related subjects, so a pause on any of them
 * still stops the email.
 */
export function combinedReminderEntityKey(recipient: string, jobIds: readonly string[]): string {
  const digest = createHash("sha256").update(JSON.stringify([recipient.trim().toLowerCase(), [...jobIds].sort()])).digest("hex").slice(0, 24);
  return `JobReminderBatch:${digest}`;
}
