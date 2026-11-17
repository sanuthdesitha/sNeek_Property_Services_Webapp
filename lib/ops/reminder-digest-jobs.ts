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
export function toDigestJob(job: DigestSourceJob, input: { timezone: string; defaultTime: string; timeLabel?: string }): ReminderDigestJob {
  return {
    jobId: job.id,
    jobReference: getJobReference(job),
    propertyName: job.property.name,
    propertyAddress: job.property.address ?? "",
    jobTypeLabel: job.jobType.replace(/_/g, " "),
    dayLabel: format(toZonedTime(job.scheduledDate, input.timezone), "EEE d MMM"),
    timeLabel: input.timeLabel ?? job.startTime ?? "Time TBD",
    timingLines: getJobTimingHighlights(parseJobInternalNotes(job.internalNotes ?? null)),
    jobUrl: resolveAppUrl(`/cleaner/jobs/${encodeURIComponent(job.id)}`),
    sortAt: digestStartsAt(job, input.timezone, input.defaultTime).getTime(),
  };
}
