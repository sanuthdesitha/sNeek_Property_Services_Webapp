/**
 * Wording for client-handled maintenance (2026-11-18): the hand-over message
 * and the manual reminder to the client (portal inbox and email), and the
 * office's inbox notice when the client answers, sets a date or finishes.
 * Plain module.
 */
import { editable, linePart, storePart } from "./build";

const EMAIL_FROM_INBOX = "{{messageText}} is the inbox wording exactly as sent.";

export const CLIENT_MAINTENANCE_WORDING = [
  editable("client.maintenance_handover", [
    storePart("client", "Client", "INBOX", {
      title: "Please arrange: {{itemTitle}}",
      body: "Our team has asked you to arrange this repair at {{propertyName}} with your own tradesperson: {{itemTitle}}.{{officeNote}} Open Maintenance to accept it or hand it back.",
    }, ["itemTitle", "propertyName", "officeNote"], ["itemTitle"], { note: "The item page shows this wording before the office hands the item over." }),
    linePart("note-line", "Office note line", "INBOX", " Note from our team: \"{{note}}\"", ["note"], "Added only when the office writes a note."),
    storePart("client", "Client", "EMAIL", {
      subject: "Please arrange a repair at {{propertyName}}",
      body: "<p>Hi {{recipientName}},</p><p>{{messageText}}</p>",
    }, ["recipientName", "propertyName", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("client.maintenance_reminder", [
    storePart("client", "Client", "INBOX", {
      title: "Reminder: {{itemTitle}} is waiting for you",
      body: "A reminder from our team: the repair at {{propertyName}} ({{itemTitle}}) is with you to arrange. Open Maintenance to record your tradesperson and date, or hand it back.",
    }, ["itemTitle", "propertyName"], ["itemTitle"], { note: "Sent only when the office presses Remind; there is no automatic reminder." }),
    storePart("client", "Client", "EMAIL", {
      subject: "Reminder: a repair at {{propertyName}} is waiting for you",
      body: "<p>Hi {{recipientName}},</p><p>{{messageText}}</p>",
    }, ["recipientName", "propertyName", "messageText"], ["messageText"], { note: EMAIL_FROM_INBOX }),
  ]),
  editable("maintenance.client_progress", [
    storePart("accepted", "Client accepted", "INBOX", {
      title: "Client is arranging: {{itemTitle}}",
      body: "{{actorName}} accepted {{itemTitle}} at {{propertyName}} and will arrange their own tradesperson.",
    }, ["actorName", "itemTitle", "propertyName"], ["itemTitle"], { note: "Office inbox only." }),
    storePart("declined", "Client declined", "INBOX", {
      title: "Client handed back: {{itemTitle}}",
      body: "{{actorName}} declined to arrange {{itemTitle}} at {{propertyName}}. Reason: {{reason}}. It is back with the office.",
    }, ["actorName", "itemTitle", "propertyName", "reason"], ["itemTitle", "reason"], { note: "Office inbox only." }),
    storePart("date", "Client set a date", "INBOX", {
      title: "Repair date set: {{itemTitle}}",
      body: "{{actorName}} planned {{itemTitle}} at {{propertyName}} for {{when}}.",
    }, ["actorName", "itemTitle", "propertyName", "when"], ["itemTitle", "when"], { note: "Office inbox only. Also sent when the date changes or is cleared." }),
    storePart("done", "Client marked it done", "INBOX", {
      title: "Client finished: {{itemTitle}}",
      body: "{{actorName}} marked {{itemTitle}} at {{propertyName}} as done. The item is resolved; open it to see their note and photos.",
    }, ["actorName", "itemTitle", "propertyName"], ["itemTitle"], { note: "Office inbox only." }),
    storePart("not-done", "Client could not do it", "INBOX", {
      title: "Client could not get it done: {{itemTitle}}",
      body: "{{actorName}} could not get {{itemTitle}} at {{propertyName}} done. Reason: {{reason}}. It is back with the office.",
    }, ["actorName", "itemTitle", "propertyName", "reason"], ["itemTitle", "reason"], { note: "Office inbox only." }),
  ]),
];
