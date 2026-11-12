/** laundry.updates: shared templates plus the laundry services' own notices. */
import type { WordingPartDefinition } from "../types";
import { emailTemplatePart, inbox, line, notificationTemplateParts, part } from "./build";

const SCHEDULE_EMAIL = `
          <h2 style="margin:0 0 12px;">Laundry schedule updated</h2>
          <p style="margin:0 0 12px;">Admin approved reservation-driven schedule changes for <strong>{{propertyName}}</strong>.</p>
          <ul style="margin:0 0 16px 18px; padding:0;">{{bookingItems}}</ul>
          <p style="margin:0 0 16px;">Open the laundry portal to review the latest pickup and drop-off dates.</p>
          <p style="margin:0;"><a href="{{portalUrl}}">Open laundry portal</a></p>
        `;

export const LAUNDRY_UPDATE_PARTS: readonly WordingPartDefinition[] = [
  ...notificationTemplateParts("ready", "Laundry ready", "laundryReady"),
  emailTemplatePart("ready", "Laundry ready", "laundryReady"),
  ...notificationTemplateParts("skip-requested", "Skip requested", "laundrySkipRequested"),
  emailTemplatePart("skip-requested", "Skip requested", "laundrySkipRequested"),
  emailTemplatePart("skip-approved", "Skip approved", "laundrySkipApproved"),
  inbox("not-ready", "Laundry not ready (office)", "Laundry not ready - {{jobNumber}}", "{{jobNumber}}: Cleaner submitted job for {{propertyName}} with laundry_ready=NO. Laundry partner was not notified.", { required: ["jobNumber"], note: "Recorded for administrators." }),
  inbox("contradiction", "Contradiction (office)", "Laundry contradiction - {{jobNumber}}", "{{jobNumber}}: Final submission for {{propertyName}} said laundry {{outcome}}, but an earlier update already confirmed the pickup and laundry partners were notified. The confirmed pickup was KEPT - review and adjust the laundry task manually if the pickup really should be cancelled.", { required: ["jobNumber"] }),
  inbox("catch-up", "Driver catch-up", "Laundry catch-up", "{{count}} laundry {{taskWord}} {{needWord}} action: {{tasks}}. Open Today to catch up before end of day.", { required: ["count"], note: "To laundry drivers; also a browser push. {{tasks}} lists the tasks." }),
  inbox("schedule-updated", "Schedule updated after sync", "Laundry schedule updated - {{propertyName}}", "{{count}} laundry {{bookingWord}} updated after reservation sync. Review the laundry portal.", { required: ["propertyName"], note: "The title is also the email subject." }),
  part("schedule-updated", "Schedule updated after sync", "EMAIL", { subject: "{{title}}", body: SCHEDULE_EMAIL }, { required: ["propertyName"], note: "{{bookingItems}} lists each booking with its dates." }),
  part("schedule-updated", "Schedule updated after sync", "SMS", { body: "{{propertyName}}: {{count}} laundry {{bookingWord}} updated after sync. Check the laundry portal." }, { required: ["propertyName"] }),
  line("booking-new", "Booking word: new", "EMAIL", "New", "Shown for a new booking in the list."),
  line("booking-updated", "Booking word: updated", "EMAIL", "Updated", "Shown for a changed booking in the list."),
  inbox("task-deleted", "Laundry task deleted (office)", "Laundry task deleted", "{{propertyName}}: {{actor}} permanently deleted the laundry set (pickup {{pickupDate}}). {{note}}", { required: ["propertyName"] }),
  inbox("task-removed", "Laundry task removed (office)", "Laundry task removed from the boards", "{{propertyName}}: {{actor}} removed the laundry set (pickup {{pickupDate}}). {{note}}", { required: ["propertyName"] }),
  inbox("delete-approved", "Delete approved (laundry)", "Laundry delete approved", "{{propertyName}}: failed pickup delete request approved.{{notesSuffix}}", { required: ["propertyName"] }),
  inbox("skip-approved-team", "Skip approved (laundry)", "Laundry skip approved", "{{propertyName}}: failed pickup skip approved.", { required: ["propertyName"] }),
  inbox("request-rejected", "Request rejected (laundry)", "Laundry request rejected", "{{propertyName}}: failed pickup request was rejected.{{notesSuffix}}", { required: ["propertyName"] }),
  inbox("pickup-skipped", "Pickup skipped (laundry)", "Pickup skipped", "{{propertyName}}: pickup skipped.{{reasonSuffix}}", { required: ["propertyName"] }),
  line("notes-suffix", "Office notes", "INBOX", " {{notes}}", "Added when the office wrote notes."),
  line("reason-suffix", "Skip reason", "INBOX", " Reason: {{reason}}", "Added when a reason was chosen."),
];
