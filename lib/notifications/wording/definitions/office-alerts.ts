/** Wording for office.reports_generated, office.ical_alerts, agent.action_request, xero.reconnect_needed and leads.alerts. */
import { editable, inbox, line, part } from "./build";

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

const WEBSITE_QUOTE_EMAIL = `
          <h2>New quote request received</h2>
          <p><strong>Name:</strong> {{name}}</p>
          <p><strong>Email:</strong> {{email}}</p>
          <p><strong>Phone:</strong> {{phone}}</p>
          <p><strong>Suburb:</strong> {{suburb}}</p>
          <p><strong>Address:</strong> {{address}}</p>
          <p><strong>Requested service:</strong> {{service}}</p>
          <p><strong>Estimate range:</strong> {{estimate}}</p>
          <p><strong>Notes:</strong></p>
          <p>{{notesHtml}}</p>
          <p><strong>Lead ID:</strong> {{leadId}}</p>
        `;

const WEBSITE_CONTACT_EMAIL = `
          <h2>New website enquiry received</h2>
          <p><strong>Name:</strong> {{name}}</p>
          <p><strong>Email:</strong> {{email}}</p>
          <p><strong>Phone:</strong> {{phone}}</p>
          <p><strong>Suburb:</strong> {{suburb}}</p>
          <p><strong>Address:</strong> {{address}}</p>
          <p><strong>Request type:</strong> {{requestType}}</p>
          <p><strong>Requested service:</strong> {{service}}</p>
          <p><strong>Message:</strong></p>
          <p>{{notesHtml}}</p>
          <p><strong>Lead ID:</strong> {{leadId}}</p>
        `;

export const LEAD_ALERTS_WORDING = editable("leads.alerts", [
  part("website-quote", "Website quote request", "EMAIL", { subject: "New quote request: {{name}} ({{service}})", body: WEBSITE_QUOTE_EMAIL }, { required: ["leadId"], note: "To the website enquiry addresses. Each line shows a field of the form." }),
  part("website-contact", "Website enquiry", "EMAIL", { subject: "New website enquiry: {{name}} ({{requestType}})", body: WEBSITE_CONTACT_EMAIL }, { required: ["leadId"] }),
  line("not-provided", "Field left empty", "INBOX", "Not provided", "Shown for a phone, suburb or address the person left empty."),
  line("pending-review", "No estimate", "INBOX", "Pending manual review", "Shown when the quote form gave no estimate."),
  line("estimate-to", "Estimate upper bound", "INBOX", " to {{amount}}", "Added when the estimate has an upper bound."),
  line("no-notes", "No notes", "INBOX", "No extra notes provided.", "Shown when the quote form has no notes."),
  part("addon", "Add-on request", "EMAIL", { subject: "Add-on request on quote {{quoteRef}} from {{clientName}}", body: ADDON_EMAIL }, { required: ["quoteRef"], note: "To the accounts email. {{addonList}} lists the add-ons asked about." }),
  part("response", "Quote accepted or declined", "EMAIL", { subject: "Quote {{quoteRef}} {{verdict}} by {{clientName}}", body: RESPONSE_EMAIL }, { required: ["quoteRef", "verdict"], note: "{{verdict}} is \"accepted\" or \"declined\"." }),
  line("client-note", "Client note paragraph", "EMAIL", "<p style=\"margin:0 0 8px 0;\"><strong>Client note:</strong> {{note}}</p>", "Added when the client wrote a note."),
  part("counter-offer", "Counter offer", "EMAIL", { subject: "Counter offer for {{leadName}}", body: "{{quoteHtml}}" }, { required: ["quoteHtml"], note: "To the lead; {{quoteHtml}} is the generated quote document." }),
]);

export const AGENT_REQUEST_WORDING = editable("agent.action_request", [
  inbox("waiting", "Request waiting", "Agent request waiting: {{agentName}}", "{{agentName}} asks to: {{summary}} Nothing changes until someone approves it in Approvals, Agent requests.", { required: ["agentName", "summary"], note: "Inbox only, to the people who could approve it." }),
]);

export const XERO_RECONNECT_WORDING = editable("xero.reconnect_needed", [
  inbox("needed", "Reconnect needed", "Xero needs reconnecting: {{tenantName}}", "{{reason}} Invoices and bills cannot reach Xero until an administrator reconnects it in Settings, Xero. Failed pushes can then be retried.", { required: ["reason"], note: "Inbox only, to administrators, once per outage." }),
]);
