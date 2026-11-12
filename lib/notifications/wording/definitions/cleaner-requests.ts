/** Wording for office.cleaner_requests (requests from cleaners to the office, and the timing request to cleaners). */
import { editable, emailTemplatePart, inbox, line, notificationTemplateParts, part } from "./build";

const TIMING_EMAIL = `
            <p>Hello,</p>
            <p>An admin timing update needs your approval for <strong>{{propertyName}}</strong>.</p>
            <p><strong>Update type:</strong> {{updateType}}</p>
            {{requestedTimeParagraph}}
            {{adminNoteParagraph}}
            <p><a href="{{reviewUrl}}">Review and respond</a></p>
          `;

const PAY_REMINDER_EMAIL = `
    <div style="font-family:Arial,sans-serif;color:#111;">
      <h2 style="margin:0 0 8px;">{{count}} extra-pay {{requestWord}} awaiting your approval</h2>
      <p style="color:#555;margin:0 0 12px;">These have been pending for more than {{agingHours}} hours. Total requested: <strong>{{total}}</strong>. Approving affects what cleaners can invoice.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">Cleaner</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;">For</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Requested</th>
          <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #ddd;">Waiting</th>
        </tr></thead>
        <tbody>{{requestRows}}</tbody>
      </table>
      <p style="margin:16px 0;">
        <a href="{{actionUrl}}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Review pay requests</a>
      </p>
    </div>`;

export const CLEANER_REQUESTS_WORDING = editable("office.cleaner_requests", [
  ...notificationTemplateParts("extra-pay-request", "Extra pay request", "extraPayRequest"),
  emailTemplatePart("extra-pay-request", "Extra pay request", "extraPayRequest"),
  inbox("job-extra-pay", "Extra pay on a job", "Cleaner extra pay request", "{{propertyName}}: {{requestTitle}} ({{currency}} {{amount}})", { required: ["requestTitle"], note: "Sent when a cleaner asks for extra pay from the job screen." }),
  inbox("continuation", "Continuation request", "Continuation request pending", "Job {{jobId}} requires continuation approval."),
  inbox("started-early", "Future job started early", "Future job started early", "{{actorName}} started {{jobType}} at {{propertyName}} on {{today}} (scheduled {{scheduledDate}}, {{timezone}}).", { required: ["propertyName"] }),
  inbox("clock-adjustment", "Clock adjustment review", "Clock adjustment approval needed", "{{propertyName}}: {{cleanerName}} requested a clock adjustment review.", { required: ["propertyName"] }),
  inbox("reclean-submitted", "Reclean submitted", "Reclean submitted — ready to review", "{{propertyName}}: the cleaner re-did {{areaCount}} flagged area(s) and uploaded after photos/videos. Review the before vs after.", { required: ["propertyName"] }),
  inbox("timing-request", "Timing update (to cleaners)", "Timing update approval requested", "{{detail}}", { required: ["detail"], note: "{{detail}} joins the job number, property, the update line and the note with \" | \"." }),
  part("timing-request", "Timing update (to cleaners)", "EMAIL", { subject: "Timing update approval requested - {{jobRef}}", body: TIMING_EMAIL }, { required: ["reviewUrl"] }),
  part("timing-request", "Timing update (to cleaners)", "SMS", { body: "{{detail}} Review: {{reviewUrl}}" }, { required: ["reviewUrl"] }),
  line("late-checkout", "Late checkout line", "INBOX", "Late checkout until {{time}}", "The update line for a late checkout."),
  line("early-checkin", "Early check-in line", "INBOX", "Early check-in due by {{time}}", "The update line for an early check-in."),
  line("time-tbd", "Time not set", "INBOX", "time TBD", "Used for {{time}} when no time is known."),
  line("type-late", "Update type: late checkout", "EMAIL", "Late checkout", "Shown as {{updateType}} in the email."),
  line("type-early", "Update type: early check-in", "EMAIL", "Early check-in", "Shown as {{updateType}} in the email."),
  line("requested-time", "Requested time paragraph", "EMAIL", "<p><strong>Requested time:</strong> {{time}}</p>", "Added when a time was requested."),
  line("admin-note", "Admin note paragraph", "EMAIL", "<p><strong>Admin note:</strong> {{note}}</p>", "Added when the admin wrote a note."),
  inbox("pay-reminder", "Pay requests waiting", "{{companyName}}: {{count}} extra-pay {{requestWord}} awaiting approval", "{{count}} extra-pay {{requestWord}} awaiting approval — {{total}} total.", { required: ["count"], note: "Daily reminder to the office. {{requestWord}} is \"request\" or \"requests\". The title is also the email subject." }),
  part("pay-reminder", "Pay requests waiting", "EMAIL", { subject: "{{companyName}}: {{count}} extra-pay {{requestWord}} awaiting approval", body: PAY_REMINDER_EMAIL }, { required: ["count"], note: "{{requestRows}} are the waiting requests." }),
]);
