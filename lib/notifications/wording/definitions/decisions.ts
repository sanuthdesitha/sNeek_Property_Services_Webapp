/** Wording for job.cleaner_requests_decided: decisions the office (or a cleaner) makes on a request. */
import type { WordingPartDefinition } from "../types";
import { editable, inbox, line, part } from "./build";

function payShell(button: string): string {
  return `<div style="font-family:Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">{{title}}</h2>
    <div style="color:#555;margin:0 0 12px;"><p>{{messageText}}</p>{{adminNoteParagraph}}</div>
    <p style="margin:16px 0;"><a href="{{actionUrl}}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">${button}</a></p>
  </div>`;
}

/** A pay notice: inbox title/body and the "View my pay" email around the same text. */
function payNotice(id: string, label: string, title: string, body: string, required: readonly string[] = ["amount"]): WordingPartDefinition[] {
  return [
    inbox(id, label, title, body, { required }),
    part(id, label, "EMAIL", { subject: "{{companyName}}: {{title}}", body: payShell("View my pay") }, { required: ["messageText"], note: "{{title}} and {{messageText}} are the inbox title and body as sent." }),
  ];
}

const CLOCK_EMAIL = `
        <p>Hello {{recipientName}},</p>
        <p>Your clock adjustment request for <strong>{{propertyName}}</strong> ({{jobNumber}}) has been <strong>{{decision}}</strong>.</p>
        {{approvedTimeParagraph}}
        {{adminNoteParagraph}}
      `;

const EXTRA_PAY_EMAIL = `
          <p>Hello {{recipientName}},</p>
          {{intro}}
          {{decisionParagraph}}
        `;

export const DECISIONS_WORDING = editable("job.cleaner_requests_decided", [
  inbox("continuation-approved", "Continuation approved", "Continuation approved", "A continuation has been scheduled for your job ({{continuationJobId}})"),
  inbox("continuation-declined", "Continuation declined", "Continuation request declined", "{{decisionNote}}", { note: "{{decisionNote}} is the office's note, or the line below when there is none." }),
  line("declined-default", "Declined without a note", "INBOX", "Admin declined this request.", "Used when the office gave no note."),
  inbox("timing-reviewed", "Timing update answered (office)", "Timing update reviewed", "{{cleanerName}} {{decision}} the timing update for job {{jobId}}.", { note: "To the office when the cleaner answers. {{decision}} is \"approved\" or \"declined\"." }),
  inbox("clock-approved", "Clock adjustment approved", "Clock adjustment approved", "{{jobNumber}}: Admin approved your requested final time for {{propertyName}}."),
  inbox("clock-rejected", "Clock adjustment rejected", "Clock adjustment rejected", "{{jobNumber}}: Admin rejected your requested clock change for {{propertyName}}."),
  part("clock-decision", "Clock adjustment decision", "EMAIL", { subject: "{{companyName}} - Clock Adjustment {{status}}", body: CLOCK_EMAIL }, { required: ["decision"] }),
  line("approved-time", "Approved total time", "EMAIL", "<p><strong>Approved total time:</strong> {{minutes}} minutes</p>", "Added when an approved total is recorded."),
  line("admin-note", "Admin note", "EMAIL", "<p><strong>Admin note:</strong> {{note}}</p>", "Added when the office wrote a note."),
  ...payNotice("pay-addition-approved", "Extra payment approved", "Extra payment approved — {{amount}}", "An extra payment of {{amount}} has been approved for {{reason}}. It will be included in your next invoice/payroll run."),
  ...payNotice("pay-deduction-approved", "Deduction approved", "Pay deduction approved — {{amount}}", "A {{amount}} deduction has been approved against your pay for {{reason}}. It will be applied to your next invoice/payroll run."),
  ...payNotice("pay-declined", "Pay change declined", "Pay {{direction}} declined", "The proposed {{direction}} of {{amount}} for {{reason}} was not approved. Your pay is unchanged."),
  ...payNotice("pay-amount-changed", "Approved pay updated", "Approved pay updated — {{amount}}", "The approved {{direction}} for {{reason}} changed from {{previousAmount}} to {{amount}}."),
  ...payNotice("pay-reopened", "Pay change reopened", "Pay {{direction}} reopened", "The {{direction}} of {{amount}} for {{reason}} has been set back to pending review, so it no longer affects your pay until it is decided again."),
  ...payNotice("minutes-removed", "Minutes removed", "{{minutes}} min removed from your logged time", "{{minutes}} minutes were removed from your recorded time on {{propertyName}} following an approved QA rework. Reason: {{reason}}", ["minutes"]),
  ...payNotice("minutes-added", "Minutes added", "{{minutes}} min added to your logged time", "{{minutes}} minutes were added to your recorded time on {{propertyName}} for the QA rework you carried out.", ["minutes"]),
  inbox("extra-pay-reopened", "Extra pay request reopened", "Extra payment request reopened - {{propertyName}}", "Your extra payment request for {{propertyName}} was set back to pending for review.{{decisionSuffix}}"),
  inbox("extra-pay-updated", "Approved extra pay updated", "Approved payment updated - {{propertyName}}", "Your approved payment for {{propertyName}} was updated from {{oldAmount}} to {{newAmount}}.{{decisionSuffix}}"),
  inbox("extra-pay-approved", "Extra pay request approved", "Extra payment request {{status}} - {{propertyName}}", "Approved {{newAmount}} for {{propertyName}}.{{decisionSuffix}}"),
  inbox("extra-pay-rejected", "Extra pay request rejected", "Extra payment request {{status}} - {{propertyName}}", "Rejected extra payment request for {{propertyName}}.{{decisionSuffix}}"),
  inbox("extra-pay-edited", "Extra pay request edited", "Extra payment request updated - {{propertyName}}", "An admin updated the details of your extra payment request for {{propertyName}}. New requested amount: {{requestedAmount}}."),
  part("extra-pay-decision", "Extra pay request email", "EMAIL", { subject: "{{companyName}} - {{emailTitle}}", body: EXTRA_PAY_EMAIL }, { required: ["intro"], note: "{{intro}} is the matching intro paragraph below; {{decisionParagraph}} is the office's message to the cleaner." }),
  line("intro-reopened", "Intro: reopened", "EMAIL", "<p>Your extra payment request for <strong>{{propertyName}}</strong> has been set back to <strong>pending</strong> and will be reviewed again.</p>", "Email intro when the request is reopened."),
  line("intro-updated", "Intro: amount updated", "EMAIL", "<p>Your approved extra payment for <strong>{{propertyName}}</strong> has been updated from <strong>{{oldAmount}}</strong> to <strong>{{newAmount}}</strong>.</p>", "Email intro when the approved amount changes."),
  line("intro-decided", "Intro: decided", "EMAIL", "<p>Your extra payment request for <strong>{{propertyName}}</strong> has been <strong>{{decision}}</strong>.</p>{{approvedAmountParagraph}}", "Email intro when the request is approved or rejected."),
  line("approved-amount", "Approved amount", "EMAIL", "<p><strong>Approved amount:</strong> {{newAmount}}</p>", "Added to the intro when approved."),
  line("title-reopened", "Email title: reopened", "EMAIL", "Extra Payment Request Reopened", "Used as {{emailTitle}}."),
  line("title-updated", "Email title: amount updated", "EMAIL", "Approved Payment Updated", "Used as {{emailTitle}}."),
  line("title-decided", "Email title: decided", "EMAIL", "Extra Payment Request {{status}}", "Used as {{emailTitle}}."),
  line("decision-paragraph", "Office message", "EMAIL", "<p>{{message}}</p>", "The office's message to the cleaner, when written."),
]);
