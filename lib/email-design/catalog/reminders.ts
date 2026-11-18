/**
 * Combined job reminders (owner, 2026-11-17: "send the upcoming jobs reminder
 * as ONE email, not separate emails for each job"). When one run of a
 * reminder has several jobs for the same cleaner, that cleaner gets one of
 * these emails listing every job, instead of one email per job. A cleaner
 * with a single job still gets that job's own reminder email.
 *
 * The sentences come from the type's notification wording (lines
 * "digest-…"), so the office edits them where it edits the rest of that
 * reminder; the job list is data built by lib/email-design/reminder-digest.ts.
 * Plain module.
 */
import { button, callout, design, doc, heading, lineItems, note, paragraph, v } from "./build";
import type { EmailDesignDefinition } from "../types";

type ReminderDigestDesignInput = {
  key: string;
  label: string;
  typeKey: string;
  trigger: string;
  whyLine: string;
  sample: { heading: string; intro: string; outro: string; subject: string; button: string; dayList: string };
};

/** The job list sample: invented, two jobs with a timing note on one. */
const SAMPLE_LIST =
  "<ol><li><strong>The Bondi Studio</strong><br>4/22 Campbell Pde, Bondi Beach<br>Thu 12 Nov · 10:00<br>Airbnb turnover · J-1042<br>Late checkout: start after 11:00<br><a href=\"https://app.sneek.example/cleaner/jobs/1042\">Open job J-1042</a></li>" +
  "<li><strong>Manly Loft</strong><br>12 Fairlight St, Manly<br>Thu 12 Nov · 14:00<br>Deep clean · J-1061<br><a href=\"https://app.sneek.example/cleaner/jobs/1061\">Open job J-1061</a></li></ol>";
const SAMPLE_TEXT =
  "1. The Bondi Studio — 4/22 Campbell Pde, Bondi Beach\n   Thu 12 Nov · 10:00 · Airbnb turnover · J-1042\n   Late checkout: start after 11:00\n   Open job: https://app.sneek.example/cleaner/jobs/1042\n" +
  "2. Manly Loft — 12 Fairlight St, Manly\n   Thu 12 Nov · 14:00 · Deep clean · J-1061\n   Open job: https://app.sneek.example/cleaner/jobs/1061";

function reminderDigestDesign(input: ReminderDigestDesignInput): EmailDesignDefinition {
  return design({
    key: input.key,
    label: input.label,
    group: "cleaners",
    typeKey: input.typeKey,
    audience: "Cleaner",
    trigger: input.trigger,
    security: false,
    whyLine: input.whyLine,
    preferences: "cleaner",
    allowedBlocks: ["heading", "paragraph", "details", "lineItems", "callout", "button", "divider", "signature", "note"],
    mustStay: ["Job list"],
    source: `combined reminder (sentences from wording ${input.typeKey} digest lines)`,
    variables: [
      v("headingText", `Heading (wording ${input.typeKey})`, input.sample.heading, { format: "built" }),
      v("introText", `Introduction (wording ${input.typeKey})`, input.sample.intro, { format: "built" }),
      v("jobsList", "Job list (in date and start-time order, each with its link)", SAMPLE_LIST, { format: "built", textTwin: "jobsText", required: true }),
      v("jobsText", "Job list (text)", SAMPLE_TEXT),
      v("noteText", "Note from the office (empty when none)", "", { format: "built", fallback: "" }),
      v("outroText", `Closing line (wording ${input.typeKey})`, input.sample.outro, { format: "built" }),
      v("actionUrl", "Jobs link", "https://app.sneek.example/cleaner/jobs", { format: "url" }),
      v("buttonLabel", `Button label (wording ${input.typeKey})`, input.sample.button),
      v("jobCount", "Number of jobs", "2"),
      v("dayList", "Days of the jobs", input.sample.dayList),
      v("digestSubject", `Subject (wording ${input.typeKey})`, input.sample.subject),
    ],
    defaults: doc("{{digestSubject}}", "{{jobCount}} jobs · {{dayList}}", [
      heading("{{headingText}}"),
      paragraph("{{introText}}"),
      callout("note", "{{noteText}}", { showIf: "noteText" }),
      lineItems("jobsList", { lock: "required" }),
      button("Open my jobs", "actionUrl", { labelValue: "buttonLabel" }),
      note("{{outroText}}"),
    ]),
  });
}

export const REMINDER_DIGEST_DESIGN_KEYS = {
  scheduled: "jobReminderDigest",
  day: "jobDayReminderDigest",
  manual: "jobManualReminderDigest",
} as const;

export const REMINDER_DESIGNS: readonly EmailDesignDefinition[] = [
  reminderDigestDesign({
    key: REMINDER_DIGEST_DESIGN_KEYS.scheduled,
    label: "Job reminders (several jobs at once)",
    typeKey: "job.reminder.scheduled",
    trigger: "The 24-hour reminder run finds several jobs for one cleaner (one email lists them all; one job keeps the single reminder).",
    whyLine: "You got this because you accepted these jobs.",
    sample: {
      heading: "Job reminder — your next 2 jobs",
      intro: "Hello Jane, here are your upcoming jobs in one email. Please review each one and prepare before arrival.",
      outro: "Check access instructions, equipment requirements, stock levels, and any special notes before attending each property. Open a job in your portal for full details.",
      subject: "Your 2 upcoming jobs (Thu 12 Nov)",
      button: "Open my jobs",
      dayList: "Thu 12 Nov",
    },
  }),
  reminderDigestDesign({
    key: REMINDER_DIGEST_DESIGN_KEYS.day,
    label: "Today's jobs (several jobs at once)",
    typeKey: "job.cleaner_day_reminder",
    trigger: "The day-of reminder run finds several of today's jobs for one cleaner (one email lists them all; push and SMS stay one per job).",
    whyLine: "You got this because you're rostered on these jobs.",
    sample: {
      heading: "Your jobs today",
      intro: "Hello Jane, you're rostered on 2 jobs today. They are listed in start-time order.",
      outro: "Open each job in the app for access details and the checklist.",
      subject: "Your 2 jobs today (Thu 12 Nov)",
      button: "Open my jobs",
      dayList: "Thu 12 Nov",
    },
  }),
  reminderDigestDesign({
    key: REMINDER_DIGEST_DESIGN_KEYS.manual,
    label: "Unfinished job reminders (several jobs at once)",
    typeKey: "job.reminder.manual",
    trigger: "The office reminds several unfinished jobs at once by email and one cleaner is on more than one of them (one email lists them all).",
    whyLine: "You got this because these jobs are yours to finish.",
    sample: {
      heading: "Unfinished jobs",
      intro: "Hi Jane, you have 2 unfinished jobs. Please open each one and submit your checklist.",
      outro: "— sNeek Ops",
      subject: "Reminder: 2 unfinished jobs",
      button: "Open your jobs",
      dayList: "Thu 12 Nov",
    },
  }),
];
