/**
 * Other emails moved onto blocks: the bulk job offer digest, the QA result,
 * the Xero reconnect alert (new: email added to the existing inbox notice).
 * Plain module.
 */
import { callout, design, details, doc, heading, lineItems, note, paragraph, photos, button, v } from "./build";
import type { EmailDesignDefinition } from "../types";

export const OTHER_DESIGNS: readonly EmailDesignDefinition[] = [
  design({
    key: "jobAssignedBulk", label: "Job offers (several at once)", group: "cleaners", typeKey: "job.offer", audience: "Cleaner",
    trigger: "The office assigns several jobs to one cleaner in one action (one email lists them all).", security: false,
    whyLine: "You got this because you're on sNeek's cleaning team.", preferences: "cleaner",
    allowedBlocks: ["heading", "paragraph", "details", "lineItems", "callout", "button", "divider", "signature", "note"],
    mustStay: ["Job list"], source: "buildBulkAssignedEmail (sentences from wording job.offer bulk parts)",
    variables: [
      v("headingText", "Heading (wording job.offer)", "You've been assigned 3 jobs", { format: "built" }),
      v("introText", "Introduction (wording job.offer)", "Hello Jane, the following jobs have been added to your schedule.", { format: "built" }),
      v("jobsList", "Job list", "<ol><li><strong>J-1042</strong> · The Bondi Studio · Airbnb turnover · Thu 12 Nov, 10:00 am</li></ol>", { format: "built", textTwin: "jobsText", required: true }),
      v("jobsText", "Job list (text)", "J-1042 The Bondi Studio, Airbnb turnover, Thu 12 Nov 10:00 am"),
      v("outroText", "Closing line (wording job.offer)", "Please review and confirm each offer at your earliest convenience.", { format: "built" }),
      v("actionUrl", "Jobs link", "https://app.sneek.example/v2/cleaner/jobs", { format: "url" }),
      v("buttonLabel", "Button label (wording job.offer)", "Open my jobs"),
      v("jobCount", "Number of jobs", "3"),
      v("bulkSubject", "Subject (wording job.offer)", "3 new jobs assigned — sNeek Property Services"),
    ],
    defaults: doc("{{bulkSubject}}", "{{jobCount}} jobs were added to your schedule.", [
      heading("{{headingText}}"),
      paragraph("{{introText}}"),
      lineItems("jobsList", { lock: "required" }),
      button("Open my jobs", "actionUrl", { labelValue: "buttonLabel" }),
      note("{{outroText}}"),
    ]),
  }),
  design({
    key: "qaResult", label: "QA result", group: "cleaners", typeKey: "job.qa_and_accountability", audience: "Cleaner",
    trigger: "An inspection of the cleaner's job is submitted.", security: false, whyLine: "You got this because this clean was yours.", preferences: "cleaner",
    allowedBlocks: ["heading", "paragraph", "details", "lineItems", "callout", "photos", "button", "divider", "signature", "note"],
    mustStay: ["Score", "Result", "Issues list"], source: "lib/notifications/qa-result-email.ts (HTML in code)",
    variables: [
      v("headline", "Headline", "Your clean passed inspection", { keep: true }),
      v("jobLine", "Property, date and job", "The Bondi Studio · Tue 10 Nov · Job J-1042"),
      v("scoreLabel", "Score", "86%", { required: true }),
      v("ratingLabel", "Rating", "Pass"),
      v("resultLabel", "Result", "Passed", { keep: true }),
      v("breakdown", "Score breakdown", "", { format: "built" }),
      v("issuesList", "Issues", "<p><strong>Minor</strong> · Bed setup — pillow cases uneven</p>", { format: "built", textTwin: "issuesText", keep: true }),
      v("issuesText", "Issues (text)", "Minor: Bed setup — pillow cases uneven"),
      v("issuePhotos", "Marked-up photos", "", { format: "photos" }),
      v("focusLine", "What to focus on next", "Bed setup & linen"),
      v("coachingNote", "Inspector's note", "", { format: "multiline" }),
      v("statusNote", "Status note", ""),
      v("qualityUrl", "Quality page link", "https://app.sneek.example/v2/cleaner/quality", { format: "url" }),
      v("reportUrl", "Report link", "", { format: "url" }),
      v("whereSuffix", "Property for the subject", " — The Bondi Studio", { fallback: "" }),
    ],
    defaults: doc("{{companyName}}: QA {{resultLabel}} ({{scoreLabel}}){{whereSuffix}}", "Score {{scoreLabel}} · {{ratingLabel}}", [
      heading("{{headline}}"),
      paragraph("{{jobLine}}"),
      details([["Score", "**{{scoreLabel}}**"], ["Rating", "{{ratingLabel}}"], ["Result", "{{resultLabel}}"]], { lock: "required" }),
      callout("action", "{{statusNote}}", { showIf: "statusNote" }),
      lineItems("breakdown"),
      lineItems("issuesList", { lock: "required" }),
      photos("issuePhotos", "What the inspector marked."),
      callout("note", "focus next time on {{focusLine}}.", { showIf: "focusLine" }),
      paragraph("{{coachingNote}}", { showIf: "coachingNote" }),
      button("See the full feedback", "qualityUrl"),
      note("Your copy of the report: {{reportUrl}}", { showIf: "reportUrl" }),
    ]),
  }),
  design({
    key: "xeroReconnect", label: "Xero needs reconnecting", group: "office", typeKey: "xero.reconnect_needed", audience: "Administrators",
    trigger: "The Xero connection can no longer renew itself. Sent once per outage, with the inbox notice.", security: false,
    whyLine: "You got this because you're an administrator. Sent once per outage.", preferences: "staff",
    mustStay: ["Reason"], source: "wording xero.reconnect_needed (inbox only before; email is new)",
    variables: [v("tenantName", "Xero organisation", "sNeek Property Services Pty Ltd"), v("reason", "Reason", "Xero refused the refresh token (disconnected, revoked or unused for 60 days).", { required: true }), v("settingsUrl", "Xero settings link", "https://app.sneek.example/v2/admin/settings?tab=xero", { format: "url" })],
    defaults: doc("Xero needs reconnecting", "Invoices and bills can't reach Xero until it is reconnected.", [
      heading("Reconnect Xero"),
      paragraph("Xero stopped accepting sNeek's connection for **{{tenantName}}**."),
      details([["Reason", "{{reason}}"], ["Who can fix it", "An administrator, in Settings, Xero"]], { lock: "required" }),
      callout("action", "Nothing is lost. Failed pushes can be retried after you reconnect."),
      button("Reconnect Xero", "settingsUrl"),
    ]),
  }),
];
