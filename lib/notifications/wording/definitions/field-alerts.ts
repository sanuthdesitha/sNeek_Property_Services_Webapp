/** Wording for office.field_alerts: GPS, safety, maintenance and damage alerts. */
import { editable, inbox, line, part } from "./build";

const CLIENT_DAMAGE_EMAIL = `
            <p>We reported damage at <strong>{{propertyName}}</strong> and have raised a repair for it.</p>
            <p><strong>{{title}}</strong></p>
            {{descriptionParagraph}}
            <p>We will keep you updated as the repair progresses.</p>
          `;

const OFFICE_DAMAGE_EMAIL = `
          <p>A DAMAGE case was opened at <strong>{{propertyName}}</strong> and a maintenance item was created automatically.</p>
          <p><strong>{{title}}</strong>{{severitySuffix}}</p>
          {{descriptionParagraph}}
          <p><a href="{{caseUrl}}">Open the case</a> · <a href="{{maintenanceUrl}}">Open the repair</a></p>
        `;

export const FIELD_ALERTS_WORDING = editable("office.field_alerts", [
  inbox("gps-adjusted", "GPS check-in adjusted", "Cleaner adjusted GPS check-in", "{{propertyName}}: {{cleanerName}} manually adjusted their check-in location{{distanceSuffix}}.{{noteSuffix}}", { required: ["propertyName"], note: "Push to administrators." }),
  line("distance-suffix", "Distance", "INBOX", " (~{{distance}}m from property)", "Added when the distance is known."),
  inbox("off-site-start", "Started away from the property", "Job started away from the property", "{{propertyName}}: {{cleanerName}} started ~{{distance}}m away — {{reason}}.{{noteSuffix}}", { required: ["propertyName"], note: "Push to administrators. {{reason}} is the reason the cleaner chose." }),
  line("note-suffix", "Cleaner note", "INBOX", " Note: {{note}}", "Added when the cleaner wrote a note."),
  inbox("safety-overdue", "Safety check-in overdue", "Safety check-in overdue", "{{place}}: no safety check-in has been recorded {{minutes}} minutes after arrival{{forCleaners}}.", { required: ["place"], note: "Push and email to administrators." }),
  line("for-cleaners", "For the cleaners", "INBOX", " for {{cleanerNames}}", "Added when cleaners are assigned."),
  part("safety-overdue", "Safety check-in overdue", "EMAIL", { subject: "Safety check-in overdue", body: "<p>{{messageText}}</p><p><strong>Job:</strong> #{{jobNumber}}</p>" }, { required: ["messageText"] }),
  inbox("maintenance-flagged", "Urgent maintenance flagged", "Maintenance flagged ({{priority}}) — {{propertyName}}", "{{itemTitle}}{{areaSuffix}} ({{action}})", { required: ["itemTitle"], note: "Push to administrators for high and urgent items." }),
  line("area-suffix", "Area", "INBOX", " · {{area}}", "Added when the item has an area."),
  inbox("maintenance-visit", "Maintenance visit update", "Maintenance: {{event}}", "{{workerName}} — {{propertyName}}: {{itemTitle}}{{outcomeSuffix}}", { required: ["itemTitle"], note: "To the contact person and the office. {{event}} is the visit step (for example \"arrived\")." }),
  line("outcome-suffix", "Outcome", "INBOX", " ({{outcome}})", "Added when a completed visit has an outcome."),
  inbox("maintenance-completed", "Maintenance completed", "Maintenance completed — {{itemTitle}}", "{{actorName}} finished {{itemTitle}} at {{propertyName}}.{{noteSuffix}}", { required: ["itemTitle"], note: "To the office." }),
  inbox("price-requested", "Price change requested", "Price change requested — {{itemTitle}}", "{{actorName}} asked for {{amount}} on {{itemTitle}} (currently {{currentPay}}).{{reasonSuffix}}", { required: ["itemTitle", "amount"], note: "To the office." }),
  line("unpriced", "Unpriced", "INBOX", "unpriced", "Used for {{currentPay}} when no pay was agreed."),
  line("reason-suffix", "Reason", "INBOX", " Reason: {{note}}", "Added when the worker gave a reason."),
  part("damage-client", "Damage (client)", "EMAIL", { subject: "{{companyName}} - Damage reported at {{propertyName}}", body: CLIENT_DAMAGE_EMAIL }, { required: ["propertyName"] }),
  part("damage-client", "Damage (client)", "SMS", { body: "{{companyName}}: damage reported at {{propertyName}} - {{title}}. A repair has been raised." }, { required: ["propertyName"] }),
  part("damage-office", "Damage (office)", "EMAIL", { subject: "{{companyName}} - Damage case + repair raised ({{propertyName}})", body: OFFICE_DAMAGE_EMAIL }, { required: ["propertyName"] }),
  part("damage-critical", "Critical damage (office)", "SMS", { body: "{{companyName}}: CRITICAL damage at {{propertyName}} - {{title}}. Repair raised." }, { required: ["propertyName"], note: "SMS to administrators for critical damage only." }),
  line("description-paragraph", "Description", "EMAIL", "<p>{{description}}</p>", "Added when the report has a description."),
  line("severity-suffix", "Severity", "EMAIL", " ({{severity}})", "Added when the report has a severity."),
]);
