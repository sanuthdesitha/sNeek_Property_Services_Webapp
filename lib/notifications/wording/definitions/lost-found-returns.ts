/**
 * Wording for lost and found return requests (2026-11-20): the office's inbox
 * notice when a guest asks for an item back (or changes, withdraws, or a client
 * reviews it, or a handover needs rearranging), the cleaner's notice of a
 * handover task, and the client's inbox notice of a guest's request. The guest
 * acknowledgement is written by the office in Settings › Lost and found.
 * Plain module.
 */
import { composed, editable, storePart } from "./build";

const OFFICE_NOTE = "Office inbox only: never an email, SMS or push.";

export const LOST_FOUND_RETURN_WORDING = [
  editable("lostfound.return_request", [
    storePart("new", "Guest asked for an item back", "INBOX", {
      title: "Return requested: {{itemName}}",
      body: "{{actorName}} asked for {{itemName}} ({{propertyName}}) back: {{returnChoice}}. It is a preference until the office approves it.",
    }, ["actorName", "itemName", "propertyName", "returnChoice"], ["itemName", "returnChoice"], { note: OFFICE_NOTE }),
    storePart("changed", "Guest changed the request", "INBOX", {
      title: "Return request changed: {{itemName}}",
      body: "{{actorName}} changed how they would like {{itemName}} ({{propertyName}}) back: {{returnChoice}}.",
    }, ["actorName", "itemName", "propertyName", "returnChoice"], ["itemName", "returnChoice"], { note: OFFICE_NOTE }),
    storePart("withdrawn", "Guest withdrew the request", "INBOX", {
      title: "Return request withdrawn: {{itemName}}",
      body: "{{actorName}} withdrew their request for {{itemName}} ({{propertyName}}).",
    }, ["actorName", "itemName", "propertyName"], ["itemName"], { note: OFFICE_NOTE }),
    storePart("client-reviewed", "Client reviewed the request", "INBOX", {
      title: "Client reviewed a return request: {{itemName}}",
      body: "{{actorName}} {{reason}} the guest's request for {{itemName}} ({{propertyName}}): {{returnChoice}}.",
    }, ["actorName", "itemName", "propertyName", "returnChoice", "reason"], ["itemName", "reason"], { note: OFFICE_NOTE }),
    storePart("needs-rearranging", "Handover needs a new arrangement", "INBOX", {
      title: "Handover needs a new arrangement: {{itemName}}",
      body: "{{itemName}} ({{propertyName}}): {{reason}}",
    }, ["itemName", "propertyName", "reason"], ["itemName", "reason"], { note: OFFICE_NOTE }),
    storePart("returned", "Cleaner recorded the handover", "INBOX", {
      title: "Item handed over: {{itemName}}",
      body: "{{actorName}} completed the handover of {{itemName}} ({{propertyName}}) with a photo. The item is marked returned.",
    }, ["actorName", "itemName", "propertyName"], ["itemName"], { note: OFFICE_NOTE }),
  ]),
  editable("lostfound.return_task", [
    storePart("cleaner", "Cleaner", "INBOX", {
      title: "Lost property handover on {{jobLabel}}",
      body: "{{messageText}}",
    }, ["jobLabel", "propertyName", "messageText"], ["messageText"], { push: "SHARED", note: "{{messageText}} is the handover task as it appears on the job." }),
    storePart("cleaner", "Cleaner", "EMAIL", {
      subject: "Lost property handover on {{jobLabel}}",
      body: "<p>{{messageText}}</p>",
    }, ["jobLabel", "propertyName", "messageText"], ["messageText"], { note: "{{messageText}} is the inbox wording exactly as sent." }),
  ]),
  editable("lostfound.client_return_request", [
    storePart("client", "Client", "INBOX", {
      title: "A guest asked for an item back: {{itemName}}",
      body: "A guest asked for {{itemName}} found at {{propertyName}} back: {{returnChoice}}. Open Lost and found to review it.",
    }, ["itemName", "propertyName", "returnChoice"], ["itemName"], { note: "Portal inbox only. The office still approves the return unless Settings › Lost and found lets clients approve." }),
  ]),
  composed(
    "lostfound.return_ack",
    "The office writes this acknowledgement in Settings › Lost and found (switch, subject and message, with {{guestFirstName}}, {{itemName}}, {{choice}}, {{officeName}} and {{link}}). The exact text sent is kept on the item's timeline.",
    "/v2/admin/settings?tab=lost-found",
  ),
];
