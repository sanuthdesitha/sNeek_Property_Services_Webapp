/**
 * Emails that were HTML written inside routes, as blocks. Version 1 keeps
 * each one's words. Plain module.
 */
import { button, callout, design, doc, lineItems, note, paragraph, v } from "./build";
import type { EmailDesignDefinition } from "../types";

const CLIENT = v("clientName", "Client name", "Priya", { fallback: "" });
const SERVICE = v("service", "Service", "deep clean", { keep: true, fallback: "" });
const PLACE = v("placeSuffix", "“ at <property>” (when known)", " at The Bondi Studio", { fallback: "" });

export const ROUTE_DESIGNS: readonly EmailDesignDefinition[] = [
  design({
    key: "bookingConfirmed", label: "Booking request approved", group: "clients", typeKey: "client.documents", audience: "Client who asked for a booking",
    trigger: "The office approves a client's booking request.", security: false, whyLine: "You got this because you asked sNeek for this booking.", preferences: "client",
    mustStay: ["Date"], source: "app/api/admin/booking-requests (HTML in code)", titleOptional: true,
    variables: [CLIENT, SERVICE, PLACE, v("scheduledDate", "Booked date", "Fri 13 Nov", { keep: true, fallback: "" }), v("requestedDate", "Date the client asked for (when moved)", "", { fallback: "" })],
    defaults: doc("{{companyName}} — your booking is confirmed", "", [
      paragraph("Hello {{clientName}},"),
      paragraph("Your {{service}}{{placeSuffix}} is confirmed for **{{scheduledDate}}**."),
      paragraph("You asked for {{requestedDate}} — we have moved it to the date above to fit the team. Let us know if that does not suit.", { showIf: "requestedDate" }),
      paragraph("We will confirm your cleaner closer to the day."),
    ]),
  }),
  design({
    key: "bookingDeclined", label: "Booking request declined", group: "clients", typeKey: "client.documents", audience: "Client who asked for a booking",
    trigger: "The office declines a client's booking request.", security: false, whyLine: "You got this because you asked sNeek for this booking.", preferences: "client",
    mustStay: ["Service"], source: "app/api/admin/booking-requests (HTML in code)", titleOptional: true,
    variables: [CLIENT, SERVICE, PLACE, v("onDate", "“ on <date>” (when asked for one)", " on Fri 13 Nov", { fallback: "" }), v("reason", "Reason", "", { fallback: "" })],
    defaults: doc("{{companyName}} — we could not take that booking", "", [
      paragraph("Hello {{clientName}},"),
      paragraph("We are sorry — we could not take your {{service}}{{placeSuffix}}{{onDate}}."),
      paragraph("**Why:** {{reason}}", { showIf: "reason" }),
      paragraph("Please book another date, or reply to this email and we will find one that works."),
    ]),
  }),

  design({
    key: "insightsMonthly", label: "Monthly Insights summary", group: "office", typeKey: "insights.monthly_email", audience: "Chosen administrators and operations managers",
    trigger: "Once a month at the chosen day and hour (and the test send to yourself).", security: false, whyLine: "You got this because you're on the Monthly Insights email list.", preferences: "staff",
    allowedBlocks: ["heading", "paragraph", "details", "lineItems", "callout", "button", "divider", "signature", "note"],
    mustStay: ["Figures"], source: "lib/insights/monthly-email-content.ts (HTML in code)", titleOptional: true,
    variables: [
      v("greeting", "Greeting", "Hi Hannah,", { fallback: "Hello," }),
      v("periodLabel", "Period", "October 2026", { keep: true, fallback: "" }),
      v("sectionsHtml", "Figures (from Insights)", "<p><strong>Cleans done</strong> 42</p>", { format: "built", textTwin: "sectionsText", keep: true }),
      v("sectionsText", "Figures (text)", "Cleans done: 42"),
      v("testNote", "Test-send note", "", { fallback: "" }),
      v("financeNote", "No-finance note", "", { fallback: "" }),
      v("insightsUrl", "Insights link", "https://app.sneek.example/v2/admin/insights", { format: "url" }),
      v("subjectPrefix", "“Test: ” on a test send", "", { fallback: "" }),
    ],
    defaults: doc("{{subjectPrefix}}{{companyName}} business summary: {{periodLabel}}", "", [
      callout("action", "{{testNote}}", { showIf: "testNote" }),
      paragraph("{{greeting}}"),
      paragraph("Your business summary for **{{periodLabel}}**, from Insights. Every figure shows what it counts; a figure without enough records says so instead of showing a number."),
      lineItems("sectionsHtml", { lock: "required" }),
      button("Open Insights", "insightsUrl"),
      note("{{financeNote}}", { showIf: "financeNote" }),
    ]),
  }),

  design({
    key: "plainMessage", label: "Message written by the office", group: "office", typeKey: "client.office_messages", audience: "The person the office writes to",
    trigger: "The office sends a written message (staff message, guest message, lost property notice, a notice with no email wording).", security: false,
    whyLine: "You got this because the sNeek office wrote to you.", preferences: "none",
    mustStay: ["Message"], source: "office sends and fallbacks that wrapped the text in one paragraph (HTML in code)", titleOptional: true,
    variables: [v("greeting", "Greeting", "", { fallback: "" }), v("messageText", "Message", "The new roster is up in the team hub.", { format: "multiline", keep: true, fallback: "" })],
    defaults: doc("{{companyName}}", "", [paragraph("{{greeting}}", { showIf: "greeting" }), paragraph("{{messageText}}")]),
  }),
];
