/** Wording for office.reports_generated, office.ical_alerts and leads.alerts. */
import { editable, inbox, line, part, someParts } from "./build";

const ICAL_EMAIL = `
    <h2 style="margin:0 0 12px;">{{heading}}</h2>
    <p><strong>Property:</strong> {{propertyName}}</p>
    <p><strong>Run:</strong> {{runId}}</p>
    <p><strong>Synced at:</strong> {{syncedAt}}</p>
    {{nearTermParagraph}}
    {{summaryHtml}}
    {{changedJobsHtml}}
    {{warningsHtml}}
    <p><a href="{{propertyUrl}}">Open property</a> - <a href="{{integrationsUrl}}">Open integrations</a></p>
  `;

export const REPORTS_GENERATED_WORDING = editable("office.reports_generated", [
  inbox("generated", "Report generated", "Report generated (manual client share required)", "Report {{jobId}} generated. Use Share action to send to client.", { note: "Inbox only, when reports need an office user to share them." }),
]);

export const ICAL_ALERTS_WORDING = editable("office.ical_alerts", [
  inbox("changes", "Sync changes", "{{importantPrefix}}iCal sync changes - {{propertyName}}", "{{changeCount}} iCal sync change(s) detected for {{propertyName}}.", { required: ["propertyName"], note: "The title is also the email and SMS subject. The same body is recorded for the email." }),
  inbox("near-term", "Near-term changes", "{{importantPrefix}}iCal sync changes - {{propertyName}}", "{{urgentCount}} near-term job change(s) detected for {{propertyName}}.", { required: ["propertyName"], note: "Used instead of \"Sync changes\" when jobs in the next 48 hours changed." }),
  line("important-prefix", "IMPORTANT prefix", "INBOX", "IMPORTANT: ", "Added to the title when near-term jobs changed."),
  part("changes", "Sync changes", "EMAIL", { subject: "{{subjectLine}}", body: ICAL_EMAIL }, { required: ["propertyName"], note: "{{summaryHtml}}, {{changedJobsHtml}} and {{warningsHtml}} are the counts, changed jobs and warnings from the sync run." }),
  line("heading-urgent", "Heading (near-term)", "EMAIL", "Important iCal sync change detected", "Used as {{heading}} when near-term jobs changed."),
  line("heading", "Heading", "EMAIL", "iCal sync change summary", "Used as {{heading}} otherwise."),
  line("near-term-paragraph", "Near-term warning", "EMAIL", "<p style=\"color:#b91c1c;font-weight:700;\">Changes affect jobs scheduled today, tomorrow, or within the next 48 hours.</p>", "Added when near-term jobs changed."),
  part("near-term", "Near-term changes", "SMS", { body: "IMPORTANT iCal sync for {{propertyName}}: {{urgentJobs}}" }, { required: ["urgentJobs"], note: "Sent only when near-term jobs changed. {{urgentJobs}} lists up to three jobs." }),
]);

const ADDON_EMAIL = `
            <h2 style="margin:0 0 12px 0;">Add-on request — quote {{quoteRef}}</h2>
            <p style="margin:0 0 8px 0;"><strong>{{clientName}}</strong> asked about these add-ons on their {{serviceType}} quote:</p>
            <ul style="margin:0 0 12px 0;padding-left:20px;">
              {{addonList}}
            </ul>
            {{clientNoteParagraph}}
            <p style="margin:0;color:#6b7280;font-size:13px;">Quote ID: {{quoteId}}</p>
          `;

const RESPONSE_EMAIL = `
            <h2 style="margin:0 0 12px 0;">Quote {{quoteRef}} {{verdict}}</h2>
            <p style="margin:0 0 8px 0;"><strong>{{clientName}}</strong> has {{verdict}} their {{serviceType}} quote (total {{total}}).</p>
            {{clientNoteParagraph}}
            <p style="margin:0;color:#6b7280;font-size:13px;">Quote ID: {{quoteId}}</p>
          `;

export const LEAD_ALERTS_WORDING = someParts("leads.alerts", [
  part("addon", "Add-on request", "EMAIL", { subject: "Add-on request on quote {{quoteRef}} from {{clientName}}", body: ADDON_EMAIL }, { required: ["quoteRef"], note: "To the accounts email. {{addonList}} lists the add-ons asked about." }),
  part("response", "Quote accepted or declined", "EMAIL", { subject: "Quote {{quoteRef}} {{verdict}} by {{clientName}}", body: RESPONSE_EMAIL }, { required: ["quoteRef", "verdict"], note: "{{verdict}} is \"accepted\" or \"declined\"." }),
  line("client-note", "Client note paragraph", "EMAIL", "<p style=\"margin:0 0 8px 0;\"><strong>Client note:</strong> {{note}}</p>", "Added when the client wrote a note."),
  part("counter-offer", "Counter offer", "EMAIL", { subject: "Counter offer for {{leadName}}", body: "{{quoteHtml}}" }, { required: ["quoteHtml"], note: "To the lead; {{quoteHtml}} is the generated quote document." }),
], "Website quote and contact enquiries are composed in the public lead and contact routes from the form's answers (each line is a form field).");
