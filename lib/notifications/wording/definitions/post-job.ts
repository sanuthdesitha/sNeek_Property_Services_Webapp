/**
 * client.post_job: the three follow-up emails, the QA feedback invite, and the
 * fixed pieces around the automation rules (each rule's own subject and body
 * stay in the rule editor).
 */
import { editable, line, part } from "./build";

const THANKS = `
        <h2 style="margin:0 0 12px;">Thanks for booking with sNeek</h2>
        <p>Hello {{clientName}},</p>
        <p>Thank you for trusting us with your {{service}} at <strong>{{propertyName}}</strong>.</p>
        <p>Your service dated <strong>{{cleanDate}}</strong> has been completed and recorded in the system.</p>
        <p>If you need anything further, just reply to this email and our team will take care of it.</p>
      `;

const RATING = `
        <h2 style="margin:0 0 12px;">How did we do?</h2>
        <p>Hello {{clientName}},</p>
        <p>We would appreciate a quick rating for your recent {{service}} at <strong>{{propertyName}}</strong>.</p>
        <p>Your feedback helps us keep quality high and improve follow-up when anything needs attention.</p>
        <p><a href="{{ratingUrl}}" target="_blank" rel="noopener noreferrer">Rate your clean now</a></p>
      `;

const REBOOK = `
      <h2 style="margin:0 0 12px;">Need another clean booked?</h2>
      <p>Hello {{clientName}},</p>
      <p>If you would like to line up the next service for <strong>{{propertyName}}</strong>, we can arrange it now.</p>
      <p>Use the link below to request a new quote or booking and we will take care of the rest.</p>
      <p><a href="{{quoteUrl}}" target="_blank" rel="noopener noreferrer">Request your next clean</a></p>
    `;

export const POST_JOB_WORDING = editable("client.post_job", [
  part("follow-up-1d", "Thank you (day 1)", "EMAIL", { subject: "Thank you for choosing sNeek - {{jobNumber}}", body: THANKS }, { required: ["propertyName"] }),
  part("follow-up-3d", "Rating request (day 3)", "EMAIL", { subject: "How was your clean at {{propertyShort}}?", body: RATING }, { required: ["ratingUrl"] }),
  part("follow-up-rebook", "Book again", "EMAIL", { subject: "Ready for your next service at {{propertyShort}}?", body: REBOOK }, { required: ["quoteUrl"] }),
  part("qa-invite", "Feedback invite", "EMAIL", { subject: "Please review your recent clean", body: "<p>Hi {{clientName}},</p><p>We'd love your feedback on your recent clean at <strong>{{propertyName}}</strong>. Please take a moment to rate the job:</p><p><a href=\"{{link}}\">{{link}}</a></p><p>This link expires in {{hours}} hours.</p><p>— sNeek</p>" }, { required: ["link"] }),
  line("rule-default-subject", "Rule subject when empty", "INBOX", "{{propertyName}} update", "The subject of an automation rule that has no subject of its own."),
  part("rule-email", "Automation rule email", "EMAIL", { subject: "{{subject}}", body: "<p>{{messageHtml}}</p>" }, { required: ["messageHtml"], note: "The wrapper around each automation rule's message; {{messageHtml}} is the rule's message with its line breaks." }),
], "Each automation rule's own subject and message are written in the rule editor (client automation settings).");
