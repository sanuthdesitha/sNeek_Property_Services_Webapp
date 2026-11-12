/**
 * job.offer: shared "Job Assigned" / "Job Removed" templates plus the sentences
 * the assignment routes add (inbox titles, bulk digest, transfer and the
 * accept / decline / transfer notices to the office).
 */
import type { WordingPartDefinition } from "../types";
import { emailTemplatePart, inbox, line, notificationTemplateParts, part } from "./build";

const RESPONSE_EMAIL = `
          <h2 style="margin:0 0 12px;">{{title}}</h2>
          <p><strong>{{jobNumber}}</strong> for <strong>{{propertyName}}</strong> ({{when}}) was updated.</p>
          <p><strong>Cleaner:</strong> {{actorName}}</p>
          <p><strong>Outcome:</strong> {{outcome}}</p>
          <p><strong>Next job status:</strong> {{nextStatus}}</p>
          {{cleanerNoteParagraph}}
        `;

function response(id: string, label: string, title: string, body: string, sms: string): WordingPartDefinition[] {
  return [
    inbox(id, label, title, body, { required: ["jobNumber"], note: "To the office. The title is also the email subject." }),
    part(id, label, "SMS", { body: sms }, { required: ["jobNumber"] }),
  ];
}

export const JOB_OFFER_PARTS: readonly WordingPartDefinition[] = [
  ...notificationTemplateParts("cleaner", "Cleaner", "jobAssigned"),
  emailTemplatePart("cleaner", "Cleaner", "jobAssigned"),
  ...notificationTemplateParts("removed", "Removed from the job", "jobRemoved"),
  emailTemplatePart("removed", "Removed from the job", "jobRemoved"),
  line("title-offer", "Title: new offer", "INBOX", "{{companyName}}: New job offer ({{jobNumber}})", "Inbox title of a new offer (used when the shared template has no title) and the log subject."),
  line("title-updated", "Title: assignment updated", "INBOX", "{{companyName}}: Job assignment updated ({{jobNumber}})", "When an existing assignment changes."),
  line("title-removed", "Title: removed", "INBOX", "{{companyName}}: Job removed from your schedule ({{jobNumber}})", "When the cleaner is taken off the job."),
  line("title-transfer", "Title: transferred offer", "INBOX", "{{companyName}}: New transferred job offer ({{jobNumber}})", "Inbox title of an offer transferred by another cleaner."),
  line("title-rule-alert", "Title: rule alert", "INBOX", "{{companyName}}: Rule alert", "Inbox title for people added by a notification rule."),
  line("awaiting-confirmation", "Awaiting confirmation", "INBOX", "Awaiting confirmation", "Used as {{timingFlags}} on a new offer."),
  line("transferred-by", "Transferred by", "INBOX", "Transferred by {{actorName}}. Awaiting confirmation.", "Used as {{timingFlags}} in the transferred offer email."),
  part("bulk", "Bulk offer SMS (one job)", "SMS", { body: "{{companyName}}: New job offer {{jobNumber}} — {{propertyName}} on {{when}}. Open the app to confirm." }, { required: ["jobNumber"] }),
  part("bulk-many", "Bulk offer SMS (several jobs)", "SMS", { body: "{{companyName}}: {{jobCount}} new jobs assigned ({{refs}}). Open the app to review and confirm." }, { required: ["jobCount"] }),
  line("bulk-sms-subject", "Bulk SMS log subject", "INBOX", "{{companyName}}: {{jobCount}} new {{jobWord}} assigned", "The subject recorded for the bulk SMS."),
  line("bulk-subject", "Bulk email subject", "INBOX", "{{jobCount}} new {{jobWord}} assigned — {{companyName}}", "Subject of the combined assignment email."),
  line("bulk-heading", "Bulk email heading", "EMAIL", "You've been assigned {{jobCount}} {{jobWord}}", "Heading of the combined assignment email."),
  line("bulk-intro", "Bulk email intro", "EMAIL", "Hello {{userName}}, the following {{jobWord}} {{hasWord}} been added to your schedule. Open the Cleaner Portal to confirm {{itWord}} and view full access details.", "{{hasWord}} is \"has\"/\"have\"; {{itWord}} is \"it\"/\"each one\"."),
  line("bulk-outro", "Bulk email closing line", "EMAIL", "Please review and confirm {{offerWord}} at your earliest convenience.", "{{offerWord}} is \"this offer\"/\"each offer\"."),
  line("bulk-button-one", "Bulk button (one job)", "INBOX", "Open job", "Button label for one job."),
  line("bulk-button-many", "Bulk button (several jobs)", "INBOX", "Open my jobs", "Button label for several jobs."),
  ...response("accepted", "Accepted (office)", "{{companyName}}: Job accepted ({{jobNumber}})", "{{actorName}} accepted {{jobNumber}} for {{propertyName}}.", "{{actorName}} accepted {{jobNumber}} at {{propertyName}}."),
  ...response("declined", "Declined (office)", "{{companyName}}: Job declined ({{jobNumber}})", "{{actorName}} declined {{jobNumber}} for {{propertyName}}.", "{{actorName}} declined {{jobNumber}} at {{propertyName}}."),
  ...response("transferred", "Transferred (office)", "{{companyName}}: Job transferred ({{jobNumber}})", "{{actorName}} transferred {{jobNumber}} for {{propertyName}} to {{transferredTo}}.", "{{actorName}} transferred {{jobNumber}} to {{transferredTo}}."),
  part("response", "Response email (office)", "EMAIL", { subject: "{{title}}", body: RESPONSE_EMAIL }, { required: ["jobNumber"], note: "{{title}} is the matching office notice title; {{outcome}} the line below." }),
  line("outcome-accepted", "Outcome: accepted", "EMAIL", "Accepted", "Used as {{outcome}}."),
  line("outcome-declined", "Outcome: declined", "EMAIL", "Declined", "Used as {{outcome}}."),
  line("outcome-transferred", "Outcome: transferred", "EMAIL", "Transferred to {{transferredTo}}", "Used as {{outcome}}."),
  line("cleaner-note", "Cleaner note", "EMAIL", "<p><strong>Cleaner note:</strong> {{note}}</p>", "Added when the cleaner wrote a note."),
];

/** job.skipped_or_cancelled: skip decisions to the client and iCal shift cancellations to cleaners. */
export const SKIPPED_PARTS: readonly WordingPartDefinition[] = [
  inbox("skip-approved", "Skip approved (client)", "Clean skipped", "Your request to skip the clean at {{propertyName}} was approved — this turnover will not be cleaned.", { required: ["propertyName"] }),
  inbox("skip-declined", "Skip declined (client)", "Skip request declined", "Your request to skip the clean at {{propertyName}} was declined — the clean will go ahead as scheduled.", { required: ["propertyName"] }),
  inbox("booking-moved", "Booking moved (cleaner)", "Shift cancelled — booking moved", "{{propertyName}}: your shift on {{oldDate}} was removed because the booking moved to {{newDate}}. The job is now unassigned.", { required: ["oldDate"], note: "From iCal sync." }),
  inbox("booking-removed", "Booking removed (cleaner)", "Shift cancelled — booking removed", "{{propertyName}}: your shift on {{oldDate}} was cancelled because the booking is no longer on the calendar. It has been removed from your schedule.", { required: ["oldDate"], note: "From iCal sync." }),
];
