/**
 * The combined job reminder email: ONE email listing several jobs for one
 * cleaner (designs in catalog/reminders.ts). The job list is data built and
 * escaped here; every sentence around it comes from the type's notification
 * wording ("digest-…" lines), so the office edits it there and in the email
 * design editor. The result is ready for sendEmailDetailed: the send path
 * renders it again with the published design version and Email look.
 */
import { buildDesignedEmail } from "./build-email";
import type { CompanySettingsLike } from "./compose";
import { escapeHtml } from "./render";
import { REMINDER_DIGEST_DESIGN_KEYS } from "./catalog/reminders";

export type ReminderDigestKind = keyof typeof REMINDER_DIGEST_DESIGN_KEYS;

/** One job in a combined reminder, already formatted in the organisation's timezone. */
export type ReminderDigestJob = {
  jobId: string;
  jobReference: string;
  propertyName: string;
  propertyAddress: string;
  jobTypeLabel: string;
  /** Calendar day of the job, e.g. "Thu 12 Nov". */
  dayLabel: string;
  /** Start time as the job carries it, e.g. "10:00" (or "Time TBD"). */
  timeLabel: string;
  /** The job's timing lines (late checkout, early check-in, same-day check-in). */
  timingLines: string[];
  /** High-priority task lines for this job, e.g. a device to charge (2026-11-20). */
  priorityLines?: string[];
  /** Absolute link to the job in the cleaner portal. */
  jobUrl: string;
  /** Scheduled start in epoch milliseconds: the list is sorted by it (date, then start time). */
  sortAt: number;
};

/** The sentences of the email, rendered from the type's wording for this cleaner. */
export type ReminderDigestTexts = {
  subject: string;
  headingHtml: string;
  introHtml: string;
  outroHtml: string;
  buttonLabel: string;
  /** Escaped note from the office (manual reminder), or "". */
  noteHtml?: string;
};

export type ReminderDigestEmail = { subject: string; html: string; text: string; missing: string[]; jobIds: string[] };

/** Date order, then start time; a stable tie-break on the reference keeps the order the same every run. */
export function sortDigestJobs(jobs: readonly ReminderDigestJob[]): ReminderDigestJob[] {
  return [...jobs].sort((a, b) => a.sortAt - b.sortAt || a.jobReference.localeCompare(b.jobReference));
}

/** The distinct days of the jobs, in order ("Thu 12 Nov, Fri 13 Nov"). */
export function digestDayList(jobs: readonly ReminderDigestJob[]): string {
  return Array.from(new Set(sortDigestJobs(jobs).map((job) => job.dayLabel))).join(", ");
}

/** An absolute http(s) link, or an app path ("/cleaner/jobs/…") that the send path makes absolute. */
function safeLink(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return /^\/(?!\/)[^\s"'<>]*$/.test(trimmed) ? trimmed : null;
}

function jobItemHtml(job: ReminderDigestJob): string {
  const lines = [
    `<strong class="sn-ink" style="font-weight:600">${escapeHtml(job.propertyName)}</strong>`,
    job.propertyAddress ? escapeHtml(job.propertyAddress) : "",
    `${escapeHtml(job.dayLabel)} · ${escapeHtml(job.timeLabel)}`,
    `${escapeHtml(job.jobTypeLabel)} · ${escapeHtml(job.jobReference)}`,
    ...job.timingLines.map((line) => `<span style="font-weight:600">${escapeHtml(line)}</span>`),
    ...(job.priorityLines ?? []).map((line) => `<span style="font-weight:600">${escapeHtml(line)}</span>`),
  ].filter(Boolean);
  const href = safeLink(job.jobUrl);
  const link = href
    ? `<a href="${escapeHtml(href)}" class="sn-br" style="text-decoration:underline;font-weight:600">Open job ${escapeHtml(job.jobReference)}</a>`
    : "";
  return `<li style="margin:0 0 14px">${[...lines, link].filter(Boolean).join("<br>")}</li>`;
}

function jobItemText(job: ReminderDigestJob, index: number): string {
  const head = `${index + 1}. ${job.propertyName}${job.propertyAddress ? ` — ${job.propertyAddress}` : ""}`;
  const facts = `   ${job.dayLabel} · ${job.timeLabel} · ${job.jobTypeLabel} · ${job.jobReference}`;
  const timing = [...job.timingLines, ...(job.priorityLines ?? [])].map((line) => `   ${line}`);
  const link = safeLink(job.jobUrl) ? [`   Open job: ${job.jobUrl.trim()}`] : [];
  return [head, facts, ...timing, ...link].join("\n");
}

/** The escaped job list (HTML) and its plain-text twin. */
export function digestJobList(jobs: readonly ReminderDigestJob[]): { html: string; text: string } {
  const sorted = sortDigestJobs(jobs);
  return {
    html: `<ol style="margin:0;padding-left:20px">${sorted.map(jobItemHtml).join("")}</ol>`,
    text: sorted.map(jobItemText).join("\n\n"),
  };
}

export function buildReminderDigestEmail(
  settings: CompanySettingsLike,
  input: { kind: ReminderDigestKind; jobs: readonly ReminderDigestJob[]; texts: ReminderDigestTexts; actionUrl: string },
): ReminderDigestEmail {
  const sorted = sortDigestJobs(input.jobs);
  const list = digestJobList(sorted);
  const values: Record<string, string> = {
    headingText: input.texts.headingHtml,
    introText: input.texts.introHtml,
    jobsList: list.html,
    jobsText: list.text,
    noteText: input.texts.noteHtml ?? "",
    outroText: input.texts.outroHtml,
    actionUrl: /^https?:\/\//i.test(input.actionUrl.trim()) ? input.actionUrl.trim() : "",
    buttonLabel: input.texts.buttonLabel,
    jobCount: String(sorted.length),
    dayList: digestDayList(sorted),
    digestSubject: input.texts.subject,
  };
  const built = buildDesignedEmail(settings, REMINDER_DIGEST_DESIGN_KEYS[input.kind], values);
  return { subject: input.texts.subject, html: built.html, text: built.text, missing: built.missing, jobIds: sorted.map((job) => job.jobId) };
}
