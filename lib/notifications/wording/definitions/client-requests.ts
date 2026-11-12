/** Wording for office.client_requests: client bookings, skips, messages, approvals and relayed messages. */
import { editable, inbox, line, part } from "./build";

const BOOKING_EMAIL = `
          <p>A client requested a booking. It is <strong>not scheduled yet</strong> — approve it in Approvals to create the job.</p>
          <ul>
            <li><strong>Client:</strong> {{clientName}}</li>
            <li><strong>Property:</strong> {{propertyName}}</li>
            <li><strong>Service:</strong> {{service}}</li>
            <li><strong>Date:</strong> {{date}}</li>
            {{notesItem}}
          </ul>
        `;

const COUNTER_EMAIL = `
              <p>A client responded with a counter-offer for: <strong>{{approvalTitle}}</strong></p>
              <p>Asked: {{asked}}<br/>
                 Client offered: <strong>{{offered}}</strong></p>
              {{clientNoteParagraph}}
            `;

const DECISION_EMAIL = `
            <p>Client decision received for: <strong>{{approvalTitle}}</strong></p>
            <p>Status: <strong>{{status}}</strong></p>
            <p>Amount: {{amount}}</p>
            {{clientNoteParagraph}}
          `;

const RELAY_EMAIL = `
          <p>An admin relayed a client message for {{propertyName}}.</p>
          <blockquote>{{message}}</blockquote>
        `;

export const CLIENT_REQUESTS_WORDING = editable("office.client_requests", [
  inbox("booking", "Booking request", "Booking request awaiting approval: {{propertyName}}", "{{clientName}} requested {{booking}} for {{propertyName}}. Approve it to create the job.", { required: ["propertyName"], note: "Push to administrators. {{booking}} is the service and date. The title is also the email subject." }),
  part("booking", "Booking request", "EMAIL", { subject: "Booking request awaiting approval: {{propertyName}}", body: BOOKING_EMAIL }, { required: ["propertyName"] }),
  line("booking-label", "Booking words", "INBOX", "{{service}} on {{date}}", "Used as {{booking}}."),
  line("notes-item", "Client notes item", "EMAIL", "<li><strong>Notes:</strong> {{note}}</li>", "Added when the client wrote notes."),
  inbox("skip", "Skip request", "Skip-clean request", "{{propertyName}} requested to skip a scheduled clean{{reasonEnding}}", { required: ["propertyName"], note: "Push to administrators." }),
  line("skip-reason", "Skip reason", "INBOX", ": {{reason}}", "Ends the sentence when the client gave a reason."),
  line("skip-no-reason", "Sentence end", "INBOX", ".", "Ends the sentence when no reason was given."),
  inbox("message", "Client message", "New client message", "{{clientName}} sent a new message{{jobLabel}} in the client portal.", { required: ["clientName"], note: "Push to administrators." }),
  part("message", "Client message", "EMAIL", { subject: "New client message from {{clientName}}", body: "<p><strong>{{clientName}}</strong> sent a new portal message{{jobLabel}}.</p><p>{{message}}</p>" }, { required: ["clientName"] }),
  line("job-label", "About the job", "INBOX", " about job{{jobNumberLabel}}{{propertyLabel}}", "Added when the message is about a job."),
  inbox("counter-offer", "Counter-offer", "Client counter-offer", "{{approvalTitle}}: asked {{asked}}, client offered {{offered}}", { required: ["approvalTitle"] }),
  part("counter-offer", "Counter-offer", "EMAIL", { subject: "{{companyName}} - Client counter-offer", body: COUNTER_EMAIL }, { required: ["approvalTitle"] }),
  inbox("decision", "Approval decision", "Client approval {{decision}}", "{{approvalTitle}} ({{amount}})", { required: ["approvalTitle"], note: "{{decision}} is the decision in lower case (for example \"approved\")." }),
  part("decision", "Approval decision", "EMAIL", { subject: "{{companyName}} - Client approval {{decision}}", body: DECISION_EMAIL }, { required: ["approvalTitle"] }),
  line("client-note", "Client note paragraph", "EMAIL", "<p>Client note: {{note}}</p>", "Added when the client wrote a note."),
  inbox("relayed", "Message relayed to cleaners", "Message from the client — job {{jobRef}}", "{{propertyName}}: “{{excerpt}}” (relayed by {{actorName}})", { required: ["excerpt"], note: "To the assigned cleaners. {{excerpt}} is the first 240 characters." }),
  part("relayed", "Message relayed to cleaners", "EMAIL", { subject: "Client message relayed — job {{jobRef}}", body: RELAY_EMAIL }, { required: ["message"] }),
]);
