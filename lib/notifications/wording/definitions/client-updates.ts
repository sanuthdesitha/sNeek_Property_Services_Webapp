/**
 * client.job_updates (lib/notifications/client-job-notifications.ts): one part
 * per event and transport; the ETA, schedule note and links are line parts.
 * Which client gets which channel stays in code.
 */
import type { TypeWordingDefinition, WordingPartDefinition } from "../types";
import { editable, linePart, storePart } from "./build";

const V = ["companyName", "cleanerName", "propertyName"] as const;
const SMS_TAIL = ["trackLine", "scheduleLine"] as const;
const EMAIL_TAIL = ["scheduleParagraph", "trackLink"] as const;

function event(id: string, label: string, title: string, inboxBody: string, inboxVars: readonly string[], sms: string, smsVars: readonly string[], emailBody: string, emailVars: readonly string[]): WordingPartDefinition[] {
  return [
    storePart(id, label, "INBOX", { title, body: inboxBody }, [...V, ...inboxVars], ["propertyName"], { push: "SHARED", note: "The title is also the SMS log subject." }),
    storePart(id, label, "SMS", { body: sms }, [...V, ...smsVars], ["propertyName"]),
    storePart(id, label, "EMAIL", { subject: title, body: emailBody }, [...V, ...emailVars], ["propertyName"]),
  ];
}

export const CLIENT_UPDATE_WORDING: TypeWordingDefinition = editable("client.job_updates", [
  ...event("en-route", "On the way", "{{companyName}}: Your cleaner is on the way",
    "{{cleanerName}} is on the way to {{propertyName}}{{etaDash}}.", ["etaDash"],
    "Hi! Your {{companyName}} cleaner is on the way to {{propertyName}}.{{etaLine}}{{trackLine}}{{scheduleLine}}", ["etaLine", ...SMS_TAIL],
    "<p>Hi! Your {{companyName}} cleaner <strong>{{cleanerName}}</strong> is on the way to <strong>{{propertyName}}</strong>.</p>{{etaParagraph}}{{scheduleParagraph}}{{trackLink}}", ["etaParagraph", ...EMAIL_TAIL]),
  ...event("eta-update", "Updated ETA", "{{companyName}}: Updated ETA for your clean",
    "Updated ETA: {{cleanerName}} is now {{eta}} from {{propertyName}}.", ["eta"],
    "ETA update: Your {{companyName}} cleaner is now {{eta}} from {{propertyName}}.{{trackLine}}{{scheduleLine}}", ["eta", ...SMS_TAIL],
    "<p><strong>{{cleanerName}}</strong> is now {{eta}} from <strong>{{propertyName}}</strong>.</p>{{scheduleParagraph}}{{trackLink}}", ["eta", ...EMAIL_TAIL]),
  ...event("eta-update-no-eta", "Updated ETA (no estimate)", "{{companyName}}: Updated ETA for your clean",
    "Your cleaner is on the way to {{propertyName}}.", [],
    "Your {{companyName}} cleaner is on the way to {{propertyName}}.{{trackLine}}{{scheduleLine}}", [...SMS_TAIL],
    "<p>Your {{companyName}} cleaner is on the way to <strong>{{propertyName}}</strong>.</p>{{scheduleParagraph}}{{trackLink}}", [...EMAIL_TAIL]),
  ...event("arrived", "Arrived", "{{companyName}}: Your cleaner has arrived",
    "{{cleanerName}} has arrived at {{propertyName}}.", [],
    "Hi! Your {{companyName}} cleaner has arrived at {{propertyName}}.{{trackLine}}", ["trackLine"],
    "<p>Your {{companyName}} cleaner <strong>{{cleanerName}}</strong> has arrived at <strong>{{propertyName}}</strong> and will begin shortly.</p>{{detailsLink}}", ["detailsLink"]),
  ...event("started", "Started", "{{companyName}}: Cleaning has started",
    "{{cleanerName}} has started cleaning at {{propertyName}}.", [],
    "Hi! Your {{companyName}} cleaner has started cleaning at {{propertyName}}.", [],
    "<p>Your {{companyName}} cleaner <strong>{{cleanerName}}</strong> has started cleaning at <strong>{{propertyName}}</strong>.</p>", []),
  ...event("complete", "Complete", "{{companyName}}: Cleaning is complete",
    "The cleaning at {{propertyName}} is complete.", [],
    "Hi! The cleaning at {{propertyName}} is complete. Thank you for choosing {{companyName}}!", [],
    "<p>The cleaning at <strong>{{propertyName}}</strong> is complete.</p><p>Thank you for choosing <strong>{{companyName}}</strong>.</p>", []),
  linePart("eta-minutes", "ETA words", "SMS", "about {{etaMinutes}} {{minutesWord}} away (arriving ~{{arrivalTime}})", ["etaMinutes", "minutesWord", "arrivalTime"], "The estimate used as {{eta}} in every transport. {{minutesWord}} is \"minute\" or \"minutes\"."),
  linePart("eta-soon", "ETA words (under a minute)", "SMS", "less than a minute away", [], "Used as {{eta}} when the cleaner is a minute or less away."),
  linePart("eta-dash", "ETA (inbox)", "INBOX", " — ETA {{eta}}", ["eta"], "Added only when there is an estimate."),
  linePart("eta-line", "ETA (SMS)", "SMS", " ETA: {{eta}}.", ["eta"], "Added only when there is an estimate."),
  linePart("track-line", "Track live (SMS)", "SMS", " Track live: {{tripUrl}}", ["tripUrl"], "Added when there is a live trip link."),
  linePart("schedule-line", "Schedule note (SMS)", "SMS", " {{scheduleNote}}", ["scheduleNote"], "Added only when the cleaner is more than 10 minutes early or late."),
  linePart("running-late", "Running late note", "SMS", "Note: Your cleaner is running approximately {{minutes}} minutes behind the scheduled start time of {{startTime}}.", ["minutes", "startTime"], "Used as {{scheduleNote}} (SMS and email) when the arrival is more than 10 minutes after the start time."),
  linePart("running-early", "Arriving early note", "SMS", "Your cleaner is expected to arrive about {{minutes}} minutes before the scheduled time of {{startTime}}.", ["minutes", "startTime"], "Used as {{scheduleNote}} when the arrival is more than 10 minutes before the start time."),
  linePart("eta-paragraph", "ETA (email)", "EMAIL", "<p><strong>ETA:</strong> {{eta}}</p>", ["eta"], "Added only when there is an estimate."),
  linePart("schedule-paragraph", "Schedule note (email)", "EMAIL", "<p style=\"color:#b45309\">{{scheduleNote}}</p>", ["scheduleNote"], "Added only when the cleaner is more than 10 minutes early or late."),
  linePart("track-link", "Track live link (email)", "EMAIL", "<p><a href=\"{{tripUrl}}\">Track live</a></p>", ["tripUrl"], "Added when there is a live trip link."),
  linePart("details-link", "Job details link (email)", "EMAIL", "<p><a href=\"{{tripUrl}}\">View job details</a></p>", ["tripUrl"], "Added when there is a live trip link."),
]);
