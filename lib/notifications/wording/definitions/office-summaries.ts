/** Wording for office.cases (follow-up), office.sla_and_summaries (SLA alerts, daily briefing) and office.new_profile. */
import type { WordingPartDefinition } from "../types";
import { emailTemplatePart, inbox, line, notificationTemplateParts, part } from "./build";

const FOLLOW_UP_EMAIL = `<h2 style="margin:0 0 12px;">Cases needing follow-up</h2>
    <p>The following cases have been open without an update for more than 48 hours.</p>
    <ul style="margin:16px 0;padding-left:20px;line-height:1.7;">
      {{caseItems}}
    </ul>
    <p><a href="{{casesUrl}}" style="color:#0f766e;font-weight:600;">Open cases board</a></p>`;

const BRIEFING_EMAIL = `
    <h2 style="margin:0 0 12px;">Morning ops briefing</h2>
    <p>{{dateLabel}}</p>
    <ul style="margin:16px 0;padding-left:20px;line-height:1.7;">
      <li><strong>{{jobsToday}}</strong> jobs scheduled today</li>
      <li><strong>{{unassignedToday}}</strong> unassigned jobs today</li>
      <li><strong>{{laundryPickups}}</strong> laundry pickups today</li>
      <li><strong>{{openCases}}</strong> cases open for more than 48 hours</li>
      <li><strong>{{newLeads}}</strong> new leads in the last 24 hours</li>
      <li><strong>{{expiringDocs}}</strong> staff documents expired or expiring within 14 days</li>
    </ul>
    <p>Status mix: {{statusMix}}</p>
  `;

export const CASE_FOLLOW_UP_PARTS: readonly WordingPartDefinition[] = [
  inbox("follow-up-one", "Follow-up (one case)", "1 case needs follow-up", "{{caseLine}}", { note: "{{caseLine}} is the case, its type, property, job and how long it has been stale." }),
  inbox("follow-up-many", "Follow-up (several cases)", "{{count}} cases need follow-up", "{{count}} cases have been open for more than 48 hours.", { required: ["count"] }),
  part("follow-up", "Follow-up email", "EMAIL", { subject: "sNeek follow-up: {{title}}", body: FOLLOW_UP_EMAIL }, { required: ["caseItems"], note: "{{title}} is the inbox title; {{caseItems}} lists the stale cases." }),
];

export const SLA_PARTS: readonly WordingPartDefinition[] = [
  inbox("sla-breach", "SLA breach", "SLA breach", "{{propertyName}} ({{suburb}}) overdue by {{minutes}} mins.", { required: ["minutes"], note: "To the office, once per job and day." }),
  inbox("commercial-scan", "Commercial SLA scan", "Commercial SLA breach scan complete", "Detected {{count}} breach(es).{{issuesSentence}}", { note: "To the person who ran the scan." }),
  line("issues-sentence", "Issues created", "INBOX", " Created {{issues}} issue ticket(s).", "Added when issue tickets were created."),
  part("daily-briefing", "Daily briefing", "EMAIL", { subject: "sNeek ops briefing - {{date}}", body: BRIEFING_EMAIL }, { note: "Each count is read from the day's records." }),
  line("no-jobs", "No jobs", "EMAIL", "No jobs", "Shown as the status mix when there are no jobs today."),
  line("tomorrow-none-html", "Tomorrow: no jobs (email)", "EMAIL", "<p>No jobs are scheduled for tomorrow.</p><p>Please still check your schedule in case anything changes.</p>", "Used as the job list in the tomorrow summary when there are none."),
  line("tomorrow-none-text", "Tomorrow: no jobs (inbox, SMS)", "INBOX", "No jobs scheduled for tomorrow. Please still check your schedule in case anything changes.", "Used as the job list in the inbox and SMS when there are none."),
  line("laundry-none-html", "Tomorrow: no laundry (email)", "EMAIL", "<p>No laundry pickups or drop-offs are scheduled for tomorrow.</p><p>Please still check your laundry schedule in case anything changes.</p>", "Used when no laundry is scheduled tomorrow."),
  line("laundry-none-text", "Tomorrow: no laundry (inbox, SMS)", "INBOX", "No laundry pickups or drop-offs scheduled for tomorrow. Please still check your schedule in case anything changes.", "Used when no laundry is scheduled tomorrow."),
];

export const NEW_PROFILE_PARTS: readonly WordingPartDefinition[] = [
  ...notificationTemplateParts("office", "Office", "newProfileCreated"),
  emailTemplatePart("office", "Office", "newProfileCreated"),
  line("via-registration", "Created via: sign-up", "INBOX", "self registration", "Used as {{createdVia}} after a self sign-up."),
  line("via-onboarding", "Created via: onboarding", "INBOX", "invited account onboarding", "Used as {{createdVia}} after an invited person finishes onboarding."),
];
