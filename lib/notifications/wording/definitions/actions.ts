/** Wording definitions for the office-action types (catalog-actions.ts). */
import type { TypeWordingDefinition } from "../types";
import { composed, editable, linePart, storePart } from "./build";

const MESSAGE_TEMPLATES = "/v2/admin/forms?tab=messages&view=messages";

const NUDGE_BODY = "{{laundryAsk}} ({{propertyName}}, {{jobNumber}}){{noteSuffix}}";
const TEAM_BODY = "{{laundryAsk}} ({{place}}){{noteSuffix}}";
const LAUNDRY_ASK_NOTE = "{{laundryAsk}} is the request sentence the office chose on the Laundry screen (the same text the screen shows before sending).";
const EMAIL_FROM_INBOX = "{{messageText}} is the inbox wording exactly as sent.";

function teamPart(id: string, label: string, title: string) {
  return storePart(id, label, "INBOX", { title, body: TEAM_BODY }, ["laundryAsk", "place", "noteSuffix"], ["place"], { push: "SHARED", note: LAUNDRY_ASK_NOTE });
}

export const ACTION_WORDING: readonly TypeWordingDefinition[] = [
  composed("office.staff_message", "The office writes the subject and message each time; there is no fixed wording to edit.", MESSAGE_TEMPLATES),
  editable("laundry.cleaner_nudge", [
    storePart("ask", "Ask cleaner", "INBOX", { title: "Laundry update needed", body: NUDGE_BODY }, ["laundryAsk", "propertyName", "jobNumber", "noteSuffix"], ["propertyName"], { push: "SHARED", note: LAUNDRY_ASK_NOTE }),
    storePart("photo", "Request photo", "INBOX", { title: "Laundry photo requested", body: NUDGE_BODY }, ["laundryAsk", "propertyName", "jobNumber", "noteSuffix"], ["propertyName"], { push: "SHARED", note: LAUNDRY_ASK_NOTE }),
    linePart("note-line", "Office note line", "INBOX", " Note: {{note}}", ["note"], "Added only when the office writes a note."),
    storePart("cleaner", "Cleaner", "EMAIL", { subject: "Laundry: {{propertyName}}", body: "<p>{{messageText}}</p>" }, ["propertyName", "jobNumber", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("laundry.team_request", [
    teamPart("confirm-pickup", "Confirm pickup", "Please confirm the laundry pickup"),
    teamPart("move-pickup", "Move pickup", "Can you collect later today?"),
    teamPart("confirm-drop", "Confirm drop-off", "Please confirm the laundry drop-off"),
    teamPart("return-eta", "Return time", "When will the laundry be back?"),
    teamPart("photo", "Drop-off photo", "Drop-off photo requested"),
    linePart("note-line", "Office note line", "INBOX", " Note: {{note}}", ["note"], "Added only when the office writes a note."),
    storePart("team", "Laundry team", "EMAIL", { subject: "Laundry: {{place}}", body: "<p>{{messageText}}</p>" }, ["place", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("client.delay_notice", [
    storePart("client", "Client", "INBOX", {
      title: "Your clean is running late",
      body: "Your clean at {{propertyName}} is running late.{{etaSentence}}{{noteSuffix}}",
    }, ["propertyName", "etaSentence", "noteSuffix"], ["propertyName"], { push: "SHARED", note: "The confirm step on the job shows this wording before it is sent." }),
    linePart("eta-line", "New estimate line", "INBOX", " The new estimate is about {{etaMinutes}} minutes.", ["etaMinutes"], "Added only when the office gives a new estimate."),
    linePart("note-line", "Office note line", "INBOX", " {{note}}", ["note"], "Added only when the office writes a note."),
    storePart("client", "Client", "EMAIL", {
      subject: "Your clean is running late",
      body: "<p>Hi {{recipientName}},</p><p>{{messageText}}</p>",
    }, ["recipientName", "propertyName", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("jobs.clock_paused_by_office", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Your clock was paused by the office",
      body: "The office paused your clock on {{jobLabel}} at {{time}}. Reason given: \"{{reason}}\". Your time up to then is kept. If you are still working, open the job and tap Resume clock.",
    }, ["jobLabel", "time", "reason"], ["jobLabel", "reason"], { push: "SHARED" }),
    storePart("cleaner", "Cleaner", "EMAIL", { subject: "Your clock was paused by the office", body: "<p>{{messageText}}</p>" }, ["jobLabel", "time", "reason", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("job.office_message", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Message from the office: {{jobLabel}}",
      body: "{{messageText}}",
    }, ["jobLabel", "propertyName", "messageText"], ["messageText"], { push: "SHARED", note: "{{messageText}} is the message the office writes on the job (Message team). The title is shown above it in the cleaner's inbox, linked to the job." }),
    storePart("cleaner", "Cleaner", "SMS", { body: "sNeek office ({{jobLabel}}): {{messageText}}" }, ["jobLabel", "propertyName", "messageText"], ["messageText"]),
  ]),
  composed("guest.message", "The office writes the message to the guest each time (the subject defaults to \"About your <item>\" when left empty). Reusable message templates are in Forms.", MESSAGE_TEMPLATES),
  composed("laundry.supplier_chase", "The office writes the chase message to the supplier each time. Reusable message templates are in Forms.", MESSAGE_TEMPLATES),
  composed("lostfound.client_notice", "The office writes the subject and message to the client each time. Reusable message templates are in Forms.", MESSAGE_TEMPLATES),
  editable("workforce.document_request", [
    storePart("staff", "Staff member", "INBOX", {
      title: "Document requested",
      body: "{{requestedByName}} requested {{documentTitle}}. Upload it in your team hub.",
    }, ["requestedByName", "documentTitle"], ["documentTitle"], { push: "SHARED", note: "Also the text recorded in the delivery log for the SMS." }),
    storePart("staff", "Staff member", "EMAIL", {
      subject: "Document requested - {{documentTitle}}",
      body: "<p>Hi {{recipientName}},</p><p>Please upload the following document in your team hub: <strong>{{documentTitle}}</strong>.</p>{{notesParagraph}}",
    }, ["recipientName", "documentTitle", "notesParagraph"], ["documentTitle"]),
    linePart("notes-paragraph", "Request notes paragraph", "EMAIL", "<p>{{note}}</p>", ["note"], "Added only when the request has notes."),
  ]),
  editable("workforce.document_request_sms", [
    storePart("staff", "Staff member", "SMS", { body: "Document requested: {{documentTitle}}. Upload it in your sNeek team hub." }, ["documentTitle"], ["documentTitle"]),
  ]),
  editable("urgent_stock.purchase_ask", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Can you buy {{itemName}}?",
      body: "The office asks if you can buy {{quantity}} {{unit}} of {{itemName}} for {{propertyName}}{{beforeJob}}. Open the job to accept or decline. If you accept it goes on your shopping run; keep the receipt — the office approves the reimbursement.{{officeNote}}",
    }, ["itemName", "quantity", "unit", "propertyName", "beforeJob", "officeNote"], ["itemName", "propertyName"], { push: "SHARED", note: "The ask screen shows this wording before it is sent." }),
    linePart("job-line", "Before-job words", "INBOX", " before job {{jobNumber}}", ["jobNumber"], "Added only when the ask is for a job."),
    linePart("note-line", "Office note line", "INBOX", " Note from the office: \"{{note}}\"", ["note"], "Added only when the office writes a note."),
    storePart("cleaner", "Cleaner", "EMAIL", { subject: "Can you buy {{itemName}} for {{propertyName}}?", body: "<p>{{messageText}}</p>" }, ["itemName", "propertyName", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("client.damage_released", [
    storePart("client", "Client", "INBOX", {
      title: "A damage report for {{propertyName}} is ready",
      body: "Our cleaner recorded {{itemCount}} after the clean on {{cleanDate}}. Please review and acknowledge it in your portal.",
    }, ["propertyName", "itemCount", "cleanDate"], ["propertyName"], { note: "The Damage report page shows this wording in \"Tell the client\" before release." }),
    storePart("client", "Client", "EMAIL", {
      subject: "A damage report for {{propertyName}} is ready",
      body: "<p>Hi {{recipientName}},</p><p>{{messageText}}</p>",
    }, ["recipientName", "propertyName", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
    storePart("client", "Client", "SMS", { body: "sNeek: a damage report for {{propertyName}} is ready ({{itemCount}}). Please review it in your portal." }, ["propertyName", "itemCount"], ["propertyName"]),
  ]),
];
