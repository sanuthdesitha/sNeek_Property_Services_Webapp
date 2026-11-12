/** Wording for workforce.updates: team posts, chat, documents, credentials, recognition and hiring. */
import type { WordingPartDefinition } from "../types";
import { editable, inbox, line, part } from "./build";

const QUIZ_EMAIL = `<p>Hi {{candidateName}},</p>
<p>Thanks for applying! As the next step, please complete this short knowledge check.</p>
<p><strong>{{topicLabel}}:</strong> {{topicLine}}</p>
<p>It only takes a few minutes and is completed in one sitting.</p>
<p><a href="{{link}}" style="display:inline-block;background:#0f5a44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Start the assessment</a></p>
<p>Or paste this link into your browser: {{link}}</p>`;

function hiring(id: string, label: string, subject: string, body: string): WordingPartDefinition {
  return part(id, label, "EMAIL", { subject, body }, { note: "The starting text of the hiring email; the office can still change it in the preview before sending." });
}

export const WORKFORCE_WORDING = editable("workforce.updates", [
  inbox("team-update", "Team update", "Team update", "{{postTitle}} - {{postSummary}}", { note: "To the post's audience. {{postSummary}} is the first 120 characters." }),
  inbox("team-recognition", "Team recognition post", "Team recognition", "{{postTitle}} - {{postSummary}}"),
  inbox("chat", "Chat message", "Chat: {{channelName}}", "{{messageSummary}}", { note: "To the channel's members except the sender." }),
  inbox("document-expired", "Document expired", "Expired document - {{documentTitle}}", "{{documentTitle}} for {{personName}} has expired and needs replacement.", { required: ["documentTitle"], note: "To administrators; the same text is emailed to the staff member." }),
  inbox("document-expiring", "Document expiring", "Document expiring soon - {{documentTitle}}", "{{documentTitle}} for {{personName}} expires within 14 days.", { required: ["documentTitle"] }),
  part("document-expired", "Document expired", "EMAIL", { subject: "{{title}}", body: "<p>{{messageText}}</p>" }, { required: ["messageText"], note: "{{title}} and {{messageText}} are the inbox title and body." }),
  part("document-expiring", "Document expiring", "EMAIL", { subject: "{{title}}", body: "<p>{{messageText}}</p>" }, { required: ["messageText"] }),
  inbox("credentials-expired", "Credentials expired (digest)", "{{expiredCount}} expired {{credentialWord}} in the team", "{{lines}}", { required: ["expiredCount"], note: "One digest to administrators. {{lines}} lists each person and credential." }),
  inbox("credentials-expiring", "Credentials expiring (digest)", "{{count}} {{credentialWord}} expiring soon", "{{lines}}", { required: ["count"] }),
  part("credentials", "Credentials digest", "EMAIL", { subject: "{{title}}", body: "<ul>{{lineItems}}</ul>" }, { required: ["lineItems"] }),
  inbox("recognition", "Recognition received", "Recognition received", "{{senderName}} sent you recognition: {{recognitionTitle}}", { required: ["recognitionTitle"] }),
  inbox("hiring-application", "New hiring application", "New hiring application", "{{candidateName}} applied for {{positionTitle}}", { required: ["candidateName"], note: "To the office." }),
  part("quiz", "Knowledge check", "EMAIL", { subject: "Knowledge check{{quizSuffix}} — {{positionTitle}}", body: QUIZ_EMAIL }, { required: ["link"], note: "{{quizSuffix}} names the topic or the number of parts." }),
  line("quiz-one", "One topic (subject)", "EMAIL", ": {{topic}}", "Used as {{quizSuffix}} for one topic."),
  line("quiz-many", "Several parts (subject)", "EMAIL", " ({{count}} parts)", "Used as {{quizSuffix}} for several topics."),
  line("quiz-topics", "Several parts (body)", "EMAIL", "{{count}} short parts: {{topics}}", "Used as {{topicLine}} for several topics."),
  line("your-application", "No position", "EMAIL", "your application", "Used for {{positionTitle}} when there is none."),
  hiring("hiring-interview", "Hiring: interview", "Interview invitation - {{positionTitle}}", "<p>Hi {{candidateName}},</p><p>We would like to invite you to interview for {{positionTitle}}.</p><p>Interview time: <strong>{{interviewDate}}</strong></p><p>Please reply if you need to adjust the time.</p>"),
  hiring("hiring-offer", "Hiring: offer", "Offer details - {{positionTitle}}", "<p>Hi {{candidateName}},</p><p>We are pleased to move forward with an offer for {{positionTitle}}.</p><p>Please review the offer details shared with you and reply with any questions.</p>"),
  hiring("hiring-welcome", "Hiring: welcome", "Welcome to sNeek Property Services", "<p>Hi {{candidateName}},</p><p>Welcome to the team. We will send your onboarding and account setup details next.</p>"),
  hiring("hiring-thank-you", "Hiring: thank you", "Thank you for applying - {{positionTitle}}", "<p>Hi {{candidateName}},</p><p>Thank you for applying for {{positionTitle}}. We have received your application and will review it shortly.</p>"),
  line("welcome-note", "Staff invite welcome note", "EMAIL", "Complete your onboarding, upload your required documents, and start your assigned learning in the workforce hub.", "The welcome note in the staff account invitation (shared template \"Account Invite\")."),
], "Each credential line in the digest (for example \"Jane — Visa expires in 3 days\") is built from the credential's state.");
