/**
 * Plain names for the worker's scheduled tasks (workers/boss.ts), shown on
 * System health. Plain module: no server imports.
 *
 * `ifItFails` says what a failed run means for people, in one sentence. It is
 * shown as "What it means"; the technical name and error stay behind the
 * "Technical details" disclosure. Every task scheduled in workers/boss.ts has
 * an entry (tests/lib/system-health-model.test.ts checks this).
 */
export type ScheduledTaskInfo = {
  name: string;
  plainName: string;
  description: string;
  ifItFails: string;
  /** Where someone fixes what this task depends on, when there is such a place. */
  fix?: { label: string; href: string };
};

const SAFEGUARDS = { label: "Sending safeguards", href: "/v2/admin/notifications/safeguards" };
const XERO = { label: "Settings › Xero", href: "/v2/admin/settings?tab=xero" };
const ICAL = { label: "Settings › iCal sync", href: "/v2/admin/settings?tab=ical-sync" };
const AI = { label: "AI configuration", href: "/v2/admin/ai" };
const NOTIFICATIONS = { label: "Notifications › Health", href: "/v2/admin/notifications?tab=health" };

const TASKS: ScheduledTaskInfo[] = [
  { name: "reminder-dispatch", plainName: "Send text and email reminders", description: "Reminders before cleans", ifItFails: "Reminders due in this run may not have gone out; the next run tries the ones still due.", fix: SAFEGUARDS },
  { name: "ical-sync", plainName: "Sync booking calendars", description: "iCal feeds from Airbnb and others", ifItFails: "New, moved or cancelled bookings may not have reached the schedule yet.", fix: ICAL },
  { name: "notification-intent-dispatch", plainName: "Deliver notifications", description: "Inbox, alerts, email and SMS that are queued", ifItFails: "Queued notifications wait until a run succeeds; nothing queued is lost.", fix: NOTIFICATIONS },
  { name: "mobile-notification-dispatch", plainName: "Send phone app alerts", description: "Pushes to the phone app", ifItFails: "Phone alerts wait in the queue; inbox notices are unaffected.", fix: NOTIFICATIONS },
  { name: "notification-safeguards", plainName: "Sending safeguards check", description: "Releases held messages and keeps the sending log", ifItFails: "Messages held over quiet hours may be released late.", fix: SAFEGUARDS },
  { name: "xero-invoice-sync", plainName: "Sync invoices to Xero", description: "Checks invoices waiting for Xero", ifItFails: "Invoices waiting for Xero stay waiting until a run succeeds.", fix: XERO },
  { name: "xero-token-keepalive", plainName: "Keep Xero connected", description: "Renews the Xero sign-in once a day", ifItFails: "The Xero sign-in was not renewed today; it is renewed again on the next Xero call or tomorrow.", fix: XERO },
  { name: "daily-invoice-generation", plainName: "Create daily invoices", description: "Cleaner invoices due today", ifItFails: "Invoices due today may not have been created; nothing is sent automatically." },
  { name: "deep-clean-planning", plainName: "Plan deep cleans", description: "Proposals for properties due a deep clean", ifItFails: "A deep clean that came due may not be in the scheduling queue yet.", fix: { label: "Deep-clean scheduling", href: "/v2/admin/deep-clean-planning" } },
  { name: "recurring-job-generate", plainName: "Generate recurring jobs", description: "Jobs from recurring schedules", ifItFails: "Upcoming recurring jobs may be missing from the schedule until the next run." },
  { name: "document-expiry-check", plainName: "Check expiring documents", description: "Staff documents close to expiry", ifItFails: "Expiry reminders for staff documents may be late." },
  { name: "credential-expiry-check", plainName: "Check expiring credentials", description: "Licences and checks close to expiry", ifItFails: "Credential expiry reminders may be late." },
  { name: "job-task-auto-approve", plainName: "Approve client job requests", description: "Client requests past their approval time", ifItFails: "Client requests waiting for automatic approval stay waiting." },
  { name: "submission-followup-dispatch", plainName: "Follow up cleaner submissions", description: "Work after a cleaner submits a job", ifItFails: "Reports and checks after a submission may be late." },
  { name: "qa-report-followup-dispatch", plainName: "Follow up quality reports", description: "Work after a QA inspection", ifItFails: "Quality report follow-ups may be late." },
  { name: "case-follow-up", plainName: "Chase quiet cases", description: "Cases nobody has updated", ifItFails: "The office may not have been reminded about quiet cases." },
  { name: "weekly-laundry-plan", plainName: "Plan next week's laundry", description: "Draft laundry plan every Monday", ifItFails: "This week's laundry draft may be missing." },
  { name: "stock-alerts", plainName: "Stock alerts", description: "Low stock at properties", ifItFails: "Low-stock alerts may be late." },
  { name: "property-care", plainName: "Property care reminders", description: "Care tasks coming due", ifItFails: "Property care tasks may not have been raised on time." },
  { name: "urgent-stock-reminders", plainName: "Urgent stock reminders", description: "Urgent needs not yet handled", ifItFails: "Reminders about urgent stock may be late." },
  { name: "agent-request-expiry", plainName: "Expire agent requests", description: "Agent requests nobody approved in time", ifItFails: "Old agent requests stay open a little longer; nothing is approved by it." },
  { name: "admin-attention-summary", plainName: "Office attention summary", description: "What is waiting for the office", ifItFails: "The office summary may be late." },
  { name: "tomorrow-prep-dispatch", plainName: "Tomorrow's jobs summary", description: "Tomorrow's work for cleaners and drivers", ifItFails: "Tomorrow's summary may not have reached everyone; it is not sent twice.", fix: SAFEGUARDS },
  { name: "workforce-post-dispatch", plainName: "Team posts", description: "Scheduled posts to the team", ifItFails: "Scheduled team posts may be late." },
  { name: "email-campaign-dispatch", plainName: "Email campaigns", description: "Scheduled campaign emails", ifItFails: "Scheduled campaign emails wait until a run succeeds." },
  { name: "marketing-campaign-dispatch", plainName: "Marketing campaigns", description: "Scheduled marketing sends", ifItFails: "Scheduled marketing sends wait until a run succeeds." },
  { name: "sla-escalation", plainName: "Late-response escalation", description: "Requests past their response time", ifItFails: "Late requests may not have been escalated." },
  { name: "safety-checkin-alerts", plainName: "Safety check-ins", description: "Lone-worker check-ins that were missed", ifItFails: "A missed safety check-in may not have alerted the office." },
  { name: "insights-monthly-email", plainName: "Monthly Insights email", description: "Last month's business summary", ifItFails: "The monthly summary email may be late." },
  { name: "recognition-check", plainName: "Recognition check", description: "Weekly cleaner recognition", ifItFails: "This week's recognition may be late." },
  { name: "accountability-nightly", plainName: "Nightly accountability", description: "Streaks and accountability figures", ifItFails: "Accountability figures may be a day behind." },
  { name: "daily-ops-briefing", plainName: "Daily office briefing", description: "Morning briefing for the office", ifItFails: "This morning's briefing may not have been sent." },
  { name: "google-reviews-refresh", plainName: "Refresh Google reviews", description: "Reviews shown on the website", ifItFails: "The website may show yesterday's reviews." },
  { name: "location-pings-cleanup", plainName: "Clear old location points", description: "Removes old GPS points", ifItFails: "Old location points are kept a day longer." },
  { name: "cleaner-day-reminder", plainName: "Cleaner day reminders", description: "Reminders on the day of a clean", ifItFails: "Some day-of reminders may not have gone out.", fix: SAFEGUARDS },
  { name: "auto-clockout-sweep", plainName: "Automatic clock-out", description: "Clocks still running long after a job", ifItFails: "A forgotten clock may keep running until the next run." },
  { name: "stale-en-route-sweep", plainName: "Stale 'on the way' check", description: "Cleaners marked on the way for too long", ifItFails: "Stale 'on the way' jobs may not have been flagged." },
  { name: "auto-pause-stale-jobs", plainName: "Pause stalled jobs", description: "Jobs with no activity for hours", ifItFails: "Stalled jobs may not have been paused." },
  { name: "missed-clock-in-sweep", plainName: "Missed clock-in check", description: "Cleaners who have not clocked in", ifItFails: "A missed clock-in may not have alerted the office." },
  { name: "pending-pay-approval-reminder", plainName: "Pay approval reminder", description: "Pay amounts waiting for approval", ifItFails: "The pay approval reminder may be late." },
  { name: "unfinished-job-push-reminder", plainName: "Unfinished job reminder", description: "Evening reminder about unfinished jobs", ifItFails: "Tonight's unfinished-job reminder may not have gone out." },
  { name: "laundry-driver-nudge", plainName: "Laundry driver nudge", description: "Afternoon reminder to drivers", ifItFails: "Drivers may not have had today's nudge." },
  { name: "timing-rule-reconcile", plainName: "Check job timing rules", description: "Keeps job times in line with the rules", ifItFails: "Job times may be out of line with the rules until the next run." },
  { name: "ai-tasks", plainName: "AI tasks", description: "Queued AI work", ifItFails: "Queued AI work waits; nothing is approved by it.", fix: AI },
  { name: "media-integrity", plainName: "Photo integrity checks", description: "Duplicate and reused photo checks", ifItFails: "New photos are checked later; unchecked is never a pass." },
  { name: "social-photo-score", plainName: "Social photo scores", description: "Scores finished-job photos for social posts (no AI)", ifItFails: "New photos show \"not scored yet\" in the post generator until the next run." },
  { name: "social-planned-posts", plainName: "Planned social posts", description: "Sends social posts a person planned for a time", ifItFails: "A planned post waits; after 6 hours late it is marked not posted and the planner is told. Nothing is posted that a person did not plan." },
  { name: "social-insights", plainName: "Social post reach", description: "Reads reach and likes from Facebook and Instagram", ifItFails: "Reach and likes stay \"not recorded\"." },
  { name: "ai-photo-review", plainName: "AI photo review", description: "AI checks of job photos", ifItFails: "Photo checks wait; unchecked is never a pass.", fix: AI },
  { name: "ai-property-model-training", plainName: "Property photo memory", description: "Learns what each property looks like", ifItFails: "The photo memory is updated later.", fix: AI },
  { name: "qa-auto-score", plainName: "Automatic QA scores", description: "Scores submissions once", ifItFails: "New submissions wait for their automatic score." },
  { name: "scheduling-rules-activate", plainName: "Activate scheduling rules", description: "Switches to a newly scheduled rule version", ifItFails: "A rule version due now may switch on late." },
  { name: "scheduling-rules-weekly-snapshot", plainName: "Scheduling rules snapshot", description: "Weekly record of the rules in force", ifItFails: "This week's snapshot of the rules may be missing." },
  { name: "cleaner-property-stats", plainName: "Cleaner property figures", description: "Nightly figures per cleaner and property", ifItFails: "Cleaner figures may be a day behind." },
];

const BY_NAME = new Map(TASKS.map((task) => [task.name, task]));

export const SCHEDULED_TASK_NAMES: readonly string[] = TASKS.map((task) => task.name);

/** A task the catalog does not know keeps its internal name and a neutral sentence. */
export function scheduledTaskInfo(name: string): ScheduledTaskInfo {
  return (
    BY_NAME.get(name) ?? {
      name,
      plainName: name,
      description: "Scheduled task",
      ifItFails: "Work this task does may be late until a run succeeds.",
    }
  );
}
