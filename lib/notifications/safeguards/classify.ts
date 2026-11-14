/**
 * Sending safeguards: which class a message belongs to, what quiet hours do
 * with it, and how a send that carries no type is identified. Pure; reads only
 * the dependency-free notification catalog.
 *
 * Classes:
 * - SECURITY: sign-in codes, password reset, two-step, invitations. Exempt
 *   from the ceilings, pauses, quiet hours and the emergency stop; still
 *   dropped when an identical message was just sent (codes differ each time).
 * - ALERT: the safeguards' own alert to administrators. Exempt from pauses and
 *   the per-person ceilings (it must reach someone during a storm) but held to
 *   its own small hourly limit and one email per incident.
 * - URGENT: operational changes a person must see now (a cancelled shift, a
 *   job moved, a field alert). Exempt from quiet hours and the same-subject
 *   window; ceilings, duplicates and pauses still apply.
 * - BULK: marketing campaigns. Never trips the per-type breaker (a campaign
 *   is many recipients by design); per-person limits still apply.
 * - NORMAL: everything else.
 */
import { catalogEntryForEventKey, catalogEntryForSubject } from "../catalog";
import type { GuardedTransport } from "./config";

export type MessageClass = "SECURITY" | "ALERT" | "URGENT" | "NORMAL" | "BULK";

/** What quiet hours do with a non-urgent message to staff. */
export type QuietPolicy = "EXEMPT" | "HOLD" | "DROP";

export const SAFEGUARD_ALERT_TYPE = "system.sending_safeguard";

const SECURITY_TYPES = new Set(["account.security", "account.invitations"]);
const ALERT_TYPES = new Set([SAFEGUARD_ALERT_TYPE]);
const BULK_TYPES = new Set(["marketing.campaigns"]);

/** A person must see these now, whatever the hour. */
const URGENT_TYPES = new Set([
  "job.changed",
  "job.skipped_or_cancelled",
  "job.cancelled",
  "job.cancel_restored",
  "job.offer",
  "job.cleaner_day_reminder",
  "job.reminder.scheduled",
  "job.clock_changes",
  "job.left_site_clock_out",
  "jobs.clock_paused_by_office",
  "job.office_message",
  "office.field_alerts",
  "office.ical_alerts",
  "client.job_updates",
  "client.delay_notice",
  "guest.message",
  "system.provider_tests",
]);

/**
 * Quiet hours DROP these (the inbox copy remains): by the morning they are
 * stale or replaced by the next one. Everything else that is not urgent is
 * HELD and sent once after quiet hours.
 */
const DROP_AT_NIGHT = new Set([
  "job.reminder.unfinished_daily",
  "job.reminder.manual",
  "laundry.cleaner_nudge",
  "office.sla_and_summaries",
  "stock.alerts",
  "location.sharing",
  "location.start_without_fix",
]);

export function messageClassFor(typeKey: string, explicit?: "SECURITY" | null): MessageClass {
  if (explicit === "SECURITY" || SECURITY_TYPES.has(typeKey)) return "SECURITY";
  if (ALERT_TYPES.has(typeKey)) return "ALERT";
  if (BULK_TYPES.has(typeKey)) return "BULK";
  if (URGENT_TYPES.has(typeKey)) return "URGENT";
  return "NORMAL";
}

/**
 * Push at night is dropped (a device alert hours later is noise; the inbox
 * keeps it). Email and SMS are held unless the type is listed as dropped.
 */
export function quietPolicyFor(typeKey: string, messageClass: MessageClass, transport: GuardedTransport): QuietPolicy {
  if (messageClass === "SECURITY" || messageClass === "ALERT" || messageClass === "URGENT") return "EXEMPT";
  if (transport === "WEB_PUSH" || transport === "MOBILE_PUSH") return "DROP";
  return DROP_AT_NIGHT.has(typeKey) ? "DROP" : "HOLD";
}

export function isQuietPolicyDropType(typeKey: string): boolean {
  return DROP_AT_NIGHT.has(typeKey);
}

export type TypeHints = {
  typeKey?: string | null;
  eventKey?: string | null;
  emailKind?: string | null;
  subject?: string | null;
  category?: string | null;
  transport: GuardedTransport;
};

/**
 * The type a send belongs to. Callers that know it pass it; otherwise the
 * pipeline event key, the subject (the catalog's log subjects), the email
 * automation kind or the category is used, in that order. An unknown send is
 * "unclassified:<transport>": still capped and deduplicated, never used to
 * pause a whole type.
 */
export function deriveTypeKey(hints: TypeHints): string {
  const explicit = hints.typeKey?.trim();
  if (explicit) return explicit.slice(0, 120);
  if (hints.eventKey) {
    const byEvent = catalogEntryForEventKey(hints.eventKey);
    if (byEvent) return byEvent.key;
  }
  const bySubject = catalogEntryForSubject(hints.subject ?? null);
  if (bySubject) return bySubject.key;
  if (hints.emailKind) return `email-kind:${hints.emailKind}`;
  if (hints.category) return `category:${hints.category}`;
  return `unclassified:${hints.transport.toLowerCase()}`;
}

/** Derived catch-all keys are never paused as a type (they mix unrelated messages). */
export function isPausableTypeKey(typeKey: string): boolean {
  return !typeKey.startsWith("unclassified:") && !typeKey.startsWith("category:") && !typeKey.startsWith("email-kind:");
}
