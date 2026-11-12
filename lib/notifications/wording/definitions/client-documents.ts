/** client.documents: shared templates plus the quote-document emails and the booking-updated email. */
import type { WordingPartDefinition } from "../types";
import { emailTemplatePart, line, part } from "./build";

const BOOKING_UPDATED = `
      <h2 class="h2" style="margin:0 0 14px;font-size:24px;font-weight:600;">Your booking has been updated</h2>
      <p style="margin:0 0 14px;">Hi {{clientName}},</p>
      <p style="margin:0 0 14px;">
        We've updated your booking{{atProperty}}
        scheduled for <strong>{{dateLabel}}</strong> (job {{jobNumber}}).
      </p>
      {{addedBlock}}
      {{removedBlock}}
      {{noteParagraph}}
      <p style="margin:0 0 6px;font-size:16px;">
        Updated total for this booking: <strong>{{total}}</strong>
      </p>
      <p style="margin:14px 0 0;color:#6b6b66;font-size:13px;">
        If anything here doesn't look right, just reply or contact us and we'll sort it out.
      </p>
    `;

export const CLIENT_DOCUMENT_PARTS: readonly WordingPartDefinition[] = [
  emailTemplatePart("invoice", "Invoice issued", "clientInvoiceIssued"),
  emailTemplatePart("report", "Report shared", "cleaningReportShared"),
  emailTemplatePart("report-visibility", "Report visibility changed", "reportVisibilityChanged"),
  emailTemplatePart("quote", "Quote sent", "quoteSentToClient"),
  line("quote-subject", "Quote document subject", "INBOX", "{{companyName}}: Your quote", "Subject when the quote document is sent from the documents menu; the email body is the quote itself."),
  part("checklist", "Service checklist", "EMAIL", { subject: "{{companyName}}: Your service checklist", body: "<p>Please find the latest service checklist for your {{service}} attached.</p>" }),
  part("addons", "Optional add-ons", "EMAIL", { subject: "{{companyName}}: Optional add-ons", body: "<p>Here's our full list of optional add-ons you can add to your clean.{{onlineSentence}}</p>" }),
  line("addons-online", "Add-ons online link", "EMAIL", " You can also request them online: <a href=\"{{quoteUrl}}\">view your quote</a>.", "Added when the quote has an online link."),
  part("online-link", "Quote online link", "EMAIL", { subject: "{{companyName}}: View your quote & request add-ons online", body: "<p>You can view your quote and request any optional add-ons online here:</p><p><a href=\"{{quoteUrl}}\">{{quoteUrl}}</a></p>" }, { required: ["quoteUrl"] }),
  part("booking-updated", "Booking updated", "EMAIL", { subject: "Your booking has been updated — {{companyName}}", body: BOOKING_UPDATED }, { note: "The company header and footer are added around it. Added and removed items are listed from the booking." }),
  line("at-property", "At the property", "EMAIL", " at <strong>{{propertyName}}</strong>", "Added when the job has a property."),
  line("added-block", "Added items", "EMAIL", "<p style=\"margin:0 0 6px;font-weight:600;\">Added to your service:</p><ul style=\"margin:0 0 14px;padding-left:20px;\">{{items}}</ul>", "Added when items were added."),
  line("removed-block", "Removed items", "EMAIL", "<p style=\"margin:0 0 6px;font-weight:600;\">Removed from your service:</p><ul style=\"margin:0 0 14px;padding-left:20px;\">{{items}}</ul>", "Added when items were removed."),
  line("booking-note", "Office note", "EMAIL", "<p style=\"margin:0 0 14px;\">{{note}}</p>", "Added when the office wrote a note."),
];
