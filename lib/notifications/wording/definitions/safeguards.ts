/**
 * Wording for system.sending_safeguard: the sending safeguards' own notices to
 * administrators (lib/notifications/safeguards/alerts.ts, digest.ts). Inbox
 * for every notice; one email per incident; the daily line is inbox only.
 */
import { editable, inbox, part } from "./build";

function shell(): string {
  return `<div style="font-family:Arial,sans-serif;color:#111;">
    <h2 style="margin:0 0 8px;">{{title}}</h2>
    <p style="color:#333;margin:0 0 12px;">{{messageText}}</p>
    <p style="margin:16px 0;"><a href="{{reviewUrl}}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Review sending safeguards</a></p>
    <p style="color:#666;font-size:12px;margin:0;">This is the only email for this incident. Further attempts are counted on the screen.</p>
  </div>`;
}

export const SENDING_SAFEGUARD_WORDING = editable("system.sending_safeguard", [
  inbox(
    "tripped",
    "Sending paused (automatic)",
    "Sending paused: {{label}}",
    "{{attempts}} {{transport}} messages in {{minutes}} minutes ({{scope}}; limit {{threshold}}). Email, SMS and push for it are paused and inbox copies are kept. Recipients: {{recipients}}. It stays paused until an administrator resumes it.",
    { required: ["label", "attempts"], note: "To administrators, once per incident, when the circuit breaker trips." },
  ),
  part("tripped", "Sending paused (automatic)", "EMAIL", { subject: "Sending paused: {{label}}", body: shell() }, { required: ["title", "messageText", "reviewUrl"], note: "{{title}} and {{messageText}} are the inbox title and body as sent." }),
  inbox(
    "worker-failing",
    "Scheduled job keeps failing",
    "Scheduled job keeps failing: {{jobName}}",
    "{{jobName}} has failed {{failures}} times in a row. Last error: {{error}}. It will keep running on its schedule; this notice is sent once until it succeeds again.",
    { required: ["jobName", "failures"], note: "To administrators, once, when a worker job fails repeatedly." },
  ),
  part("worker-failing", "Scheduled job keeps failing", "EMAIL", { subject: "Scheduled job keeps failing: {{jobName}}", body: shell() }, { required: ["title", "messageText", "reviewUrl"], extra: ["jobName"], note: "{{title}} and {{messageText}} are the inbox title and body as sent." }),
  inbox(
    "digest",
    "Daily safeguards line",
    "Sending safeguards yesterday",
    "{{suppressed}} messages were not sent ({{reasons}}); {{incidents}} new incidents; {{paused}} paused now.",
    { required: ["suppressed"], note: "Inbox only, to administrators, only on a day something was suppressed or tripped." },
  ),
]);
