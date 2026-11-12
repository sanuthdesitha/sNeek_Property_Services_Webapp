/**
 * Wording definitions for the job types (catalog-jobs.ts). Every default is
 * the text its producer composed before the wording layer, byte for byte;
 * `tests/lib/notification-wording-parity.test.ts` proves it.
 */
import type { TypeWordingDefinition } from "../types";
import { editable, emailTemplatePart, inCode, linePart, someParts, storePart } from "./build";

const MANUAL_REMINDER_EMAIL = `
              <p>Hi {{recipientName}},</p>
              <p>You have an unfinished job at <strong>{{propertyName}}</strong> scheduled <strong>{{when}}</strong> — please open it and submit your checklist.</p>
              {{noteParagraph}}
              <p><a href="{{jobsUrl}}">Open your jobs</a></p>
              <p>— sNeek Ops</p>
            `;

const DAY_REMINDER_EMAIL = `
      <div style="font-family:Arial,sans-serif;color:#111;">
        <h2 style="margin:0 0 6px;">Your job today</h2>
        <p style="margin:0 0 10px;color:#555;">Today's job: {{propertyName}} ({{jobNumber}})</p>
        <table style="font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Property</td><td><strong>{{propertyName}}</strong></td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Address</td><td>{{propertyAddress}}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Start</td><td>{{when}}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Job</td><td>{{jobType}} · {{jobNumber}}</td></tr>
          {{timingRow}}
        </table>
        <p style="margin:16px 0;">
          <a href="/cleaner/jobs" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Open my jobs</a>
        </p>
      </div>`;

const INBOX_ASSIGNMENT_REASON = "Its email is the shared template below. The inbox and SMS wording is composed separately in four assignment routes (single, bulk digest, auto-assign, transfer offer) and has not been moved to the wording layer yet.";

export const JOB_WORDING: readonly TypeWordingDefinition[] = [
  editable("job.cancelled", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Job cancelled",
      body: "The job at {{propertyName}} on {{day}} ({{jobNumber}}) has been cancelled. You no longer need to attend. Reason: {{reason}}",
    }, ["propertyName", "day", "jobNumber", "reason"], ["propertyName", "reason"], { note: "Inbox only: no push, email or SMS is sent for a cancellation." }),
  ]),
  editable("job.cancel_restored", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Cancelled job is back on",
      body: "The job at {{propertyName}} on {{day}} ({{jobNumber}}) was cancelled and is now back on your list. Open it to confirm.",
    }, ["propertyName", "day", "jobNumber"], ["propertyName"], { note: "Inbox only." }),
  ]),
  editable("job.reminder.manual", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Unfinished job reminder",
      body: "You have an unfinished job at {{propertyName}} scheduled {{when}} — please open it and submit your checklist.{{noteSentence}}",
    }, ["propertyName", "when", "noteSentence"], ["propertyName"], { push: "SHARED" }),
    linePart("note-line", "Admin note line", "INBOX", " Note from admin: {{note}}", ["note"], "Added to the inbox and push wording only when the sender writes a note."),
    storePart("cleaner", "Cleaner", "EMAIL", {
      subject: "Reminder: unfinished job at {{propertyName}} ({{jobNumber}})",
      body: MANUAL_REMINDER_EMAIL,
    }, ["recipientName", "propertyName", "when", "jobNumber", "noteParagraph", "jobsUrl"], ["propertyName"]),
    linePart("note-paragraph", "Admin note paragraph", "EMAIL", "<p><em>Note from admin:</em> {{note}}</p>", ["note"], "Added to the email only when the sender writes a note."),
  ]),
  editable("job.reminder.scheduled", [
    storePart("cleaner", "Cleaner", "SMS", {
      body: "sNeek Ops: Your cleaning job at {{propertyName}} starts soon ({{when}}). {{propertyAddress}}.{{timingSuffix}}",
    }, ["propertyName", "when", "propertyAddress", "timingSuffix"], ["when", "propertyName"], { note: "The 2-hour reminder." }),
    linePart("timing-line", "Timing notes line", "SMS", " {{timingFlags}}.", ["timingFlags"], "Added to the SMS only when the job has timing notes."),
    emailTemplatePart("cleaner", "Cleaner", "jobReminder24h", [], "The 24-hour reminder: shared email template \"24h Job Reminder\" (also in Forms). The client contact's reminder is the client lifecycle email (Forms, Lifecycle)."),
  ]),
  editable("job.reminder.unfinished_daily", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Unfinished job reminder",
      body: "{{jobNumber}}: {{propertyName}} is still unfinished ({{status}}). Please open it and submit your checklist.",
    }, ["jobNumber", "propertyName", "status"], ["propertyName"], { push: "SHARED", note: "{{status}} is \"paused\" or \"in progress\"." }),
  ]),
  editable("job.cleaner_day_reminder", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Today's job: {{propertyName}} ({{jobNumber}})",
      body: "You're rostered at {{propertyName}} today at {{when}}. {{propertyAddress}}{{timingDash}}",
    }, ["propertyName", "jobNumber", "when", "propertyAddress", "timingDash"], ["propertyName"], { push: "SHARED", note: "The inbox title is also the email subject." }),
    linePart("timing-dash", "Timing notes (inbox)", "INBOX", " — {{timingFlags}}", ["timingFlags"], "Added only when the job has timing notes."),
    storePart("cleaner", "Cleaner", "EMAIL", {
      subject: "Today's job: {{propertyName}} ({{jobNumber}})",
      body: DAY_REMINDER_EMAIL,
    }, ["propertyName", "jobNumber", "propertyAddress", "when", "jobType", "timingRow"], ["propertyName"]),
    linePart("timing-row", "Timing notes row (email)", "EMAIL", "<tr><td style=\"padding:2px 10px 2px 0;color:#666;\">Notes</td><td>{{timingFlags}}</td></tr>", ["timingFlags"], "Added only when the job has timing notes."),
    storePart("cleaner", "Cleaner", "SMS", {
      body: "sNeek Ops: Today at {{when}} you're cleaning {{propertyName}} ({{jobNumber}}). {{propertyAddress}}.{{timingSuffix}}",
    }, ["when", "propertyName", "jobNumber", "propertyAddress", "timingSuffix"], ["when", "propertyName"]),
    linePart("timing-line", "Timing notes line (SMS)", "SMS", " {{timingFlags}}.", ["timingFlags"], "Added only when the job has timing notes."),
  ]),
  someParts("job.offer", [emailTemplatePart("cleaner", "Cleaner", "jobAssigned")], INBOX_ASSIGNMENT_REASON),
  inCode("job.changed", "Composed in four producers from what changed (timing rules, the special note, extra tasks, a reset or a reschedule); each change builds its own sentence around the changed values. Not yet split into named parts."),
  someParts("job.skipped_or_cancelled", [emailTemplatePart("cleaner", "Cleaner", "jobRemoved")], "The inbox and phone push (\"Shift cancelled\") are composed in the skip route and in iCal sync with different sentences for a skip, a moved booking and a removed booking; not yet moved to the wording layer."),
  inCode("job.clock_changes", "Five producers (auto clock-out, leaving the site, auto-pause, admin clock edits) each compose their own notice from the time log; not yet split into named parts."),
  someParts("job.cleaner_requests_decided", [emailTemplatePart("cleaner", "Cleaner", "extraPayRequest")], "Only the extra-pay email uses a template. The continuation, early check-out and clock-adjustment decisions are composed in five producers; not yet moved."),
  inCode("job.qa_and_accountability", "lib/notifications/accountability.ts builds about a dozen different notices (QA result, rework offer, bonus, coaching, score, streak) from scores and rules; not yet split into named parts."),
  someParts("job.cleaner_invoice", [emailTemplatePart("accounts", "Accounts", "cleanerInvoice")], "The \"change requested\" email to the cleaner is composed in lib/cleaner/invoice-admin-notify.ts; not yet moved."),
];
