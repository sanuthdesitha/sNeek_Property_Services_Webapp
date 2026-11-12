/**
 * job.qa_and_accountability (lib/notifications/accountability.ts and the
 * rework / streak / damage producers). Each notice has an inbox title and body
 * and an email in the shared Quality shell; conditional words are line parts.
 */
import type { WordingPartDefinition } from "../types";
import { inbox, line, part } from "./build";

function shell(button: string | null): string {
  const action = button
    ? `<p style="margin:16px 0;"><a href="{{actionUrl}}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">${button}</a></p>`
    : "";
  return `<div style="font-family:Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">{{title}}</h2>
    <div style="color:#555;margin:0 0 12px;"><p>{{messageText}}</p></div>
    ${action}
  </div>`;
}

/** An accountability notice: inbox title/body and the email around the same text. */
function notice(id: string, label: string, title: string, body: string, button: string | null, required: readonly string[], note?: string): WordingPartDefinition[] {
  return [
    inbox(id, label, title, body, { required, note }),
    part(id, label, "EMAIL", { subject: "{{companyName}}: {{title}}", body: shell(button) }, { required: ["title", "messageText"], note: "{{title}} and {{messageText}} are the inbox title and body as sent." }),
  ];
}

export const ACCOUNTABILITY_PARTS: readonly WordingPartDefinition[] = [
  inbox("qa-passed", "QA passed", "QA passed ({{score}}%)", "{{summary}}", { required: ["score"], note: "{{summary}} is the first lines of the QA result report. The email is the QA result report itself." }),
  inbox("qa-attention", "QA needs attention", "QA needs attention ({{score}}%){{issueSuffix}}", "{{summary}}", { required: ["score"] }),
  line("issue-suffix", "Issue summary", "INBOX", " — {{issueSummary}}", "Added when there is an issue summary."),
  part("qa-result", "QA result", "SMS", { body: "{{companyName}}: {{shortSummary}}. See the app for details." }, { required: ["shortSummary"], note: "{{shortSummary}} is the QA passed / needs attention title." }),
  ...notice("management-review", "Management review", "QA flagged for management review{{where}}", "A QA inspection{{where}}{{whoDash}} was routed to management review.{{reasonSentence}}", "Review job", [], "To administrators."),
  ...notice("false-confirmation", "False confirmations", "{{count}} suspected false {{confirmationWord}}{{where}}", "A QA inspection{{where}} flagged {{count}} suspected false {{confirmationWord}}{{whoBy}}. Please review.", "Review job", ["count"], "To administrators. {{confirmationWord}} is \"confirmation\" or \"confirmations\"."),
  ...notice("rework-offer", "Rework offered", "Rework offered{{where}} — respond within {{minutes}} min", "QA flagged items on your clean{{where}}.{{reasonSentence}} You can go back and fix it yourself at no cost to you. If you decline or the offer lapses, it is reassigned to another cleaner and the rework pay is deducted from your job.", "View rework", ["minutes"]),
  part("rework-offer", "Rework offered", "SMS", { body: "{{companyName}}: {{title}}. Open the app to accept or decline." }, { required: ["title"] }),
  ...notice("bonus-approved", "Bonus approved", "Bonus approved{{amountSuffix}}", "Your {{bonusTitle}} has been approved{{amountSuffix}} and will be included in payroll.", "View pay requests", ["bonusTitle"]),
  ...notice("bonus-declined", "Bonus not approved", "Bonus not approved", "Your {{bonusTitle}} was not approved.", "View pay requests", ["bonusTitle"]),
  line("amount-suffix", "Bonus amount", "INBOX", " (${{amount}})", "Added when the approved amount is known."),
  ...notice("coaching-created", "Coaching record", "New coaching record: {{typeLabel}}", "{{reason}}{{acknowledgeSentence}}", "View coaching", ["reason"]),
  line("retraining", "Retraining sentence", "INBOX", " Retraining is required — please acknowledge.", "Used when retraining is required."),
  line("acknowledge", "Acknowledge sentence", "INBOX", " Please review and acknowledge.", "Used otherwise."),
  ...notice("coaching-acknowledged", "Coaching acknowledged", "Coaching record acknowledged", "{{cleanerName}} has acknowledged the coaching record you created.", "View coaching", [], "To the person who created the record."),
  line("the-cleaner", "Unnamed cleaner", "INBOX", "The cleaner", "Used for {{cleanerName}} when the name is unknown."),
  ...notice("score-adjusted", "QA score adjusted", "QA score updated to {{score}}{{where}}", "An admin adjusted your QA score{{where}} to {{score}}. Reason: {{reason}}", "View job", ["score"]),
  ...notice("recurring-pattern", "Recurring issue pattern", "Recurring issue pattern: {{category}}", "{{who}} has {{count}} {{category}} {{issueWord}} in the last {{windowDays}} {{dayWord}}.{{propertySentence}}", "Open in Quality", ["count"], "To administrators."),
  line("property-sentence", "Property sentence", "INBOX", " Property: {{propertyName}}.", "Added when both the cleaner and property are known."),
  line("a-cleaner", "Unnamed subject", "INBOX", "A cleaner", "Used for {{who}} when no cleaner or property is named."),
  ...notice("restock-run", "Restock run created", "Auto shopping run created{{where}}", "{{itemCount}} low-stock {{itemWord}}{{where}} were added to an automatically created shopping run.", "Open shopping run", ["itemCount"], "To administrators."),
  ...notice("streak", "Quality streak", "Quality streak: {{streak}} {{cleanWord}}", "You're on a streak of {{streak}} high-quality {{cleanWord}}.{{toGo}}", null, ["streak"]),
  line("to-go", "Next bonus", "INBOX", " {{remaining}} more to your next bonus.", "Added when a next bonus threshold exists."),
  line("where", "At the property", "INBOX", " at {{propertyName}}", "Added when the property is known."),
  line("who-dash", "Cleaner (dash)", "INBOX", " — {{cleanerName}}", "Added when the cleaner is known."),
  line("who-by", "Cleaner (by)", "INBOX", " by {{cleanerName}}", "Added when the cleaner is known."),
  line("reason-sentence", "Reason", "INBOX", " {{reason}}", "Added when a reason is given."),
  line("rework-reason", "Rework reason", "INBOX", " Reason: {{reason}}", "Added to the rework offer when a reason is given."),
];
