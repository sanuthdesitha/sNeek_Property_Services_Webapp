/**
 * Emails that were HTML written inside routes, as blocks. Version 1 keeps
 * each one's words. Plain module.
 */
import { design, doc, paragraph, v } from "./build";
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
];
