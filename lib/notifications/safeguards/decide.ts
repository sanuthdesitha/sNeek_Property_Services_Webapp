/**
 * Sending safeguards: the decision for one message to one person on one
 * transport, from facts the gate has already read under the per-recipient
 * lock. Pure, so every rule is unit-tested without a database.
 *
 * Order (first match wins):
 *   disabled account, emergency stop, pause, identical duplicate, same type
 *   and subject, alert limit, hourly ceiling, daily ceiling, quiet hours.
 */
import { limitGroupFor, type GuardedTransport, type SafeguardLimits, type SuppressionReason } from "./config";
import type { MessageClass, QuietPolicy } from "./classify";

export type PauseHit = "TYPE" | "RECIPIENT" | "SUBJECT";

export type GuardFacts = {
  transport: GuardedTransport;
  messageClass: MessageClass;
  quietPolicy: QuietPolicy;
  recipientInactive: boolean;
  /** Quiet hours apply to staff only (never clients or the public). */
  recipientIsStaff: boolean;
  emergencyStop: boolean;
  pause: PauseHit | null;
  duplicateRecently: boolean;
  sameSubjectRecently: boolean;
  sentLastHour: number;
  sentLastDay: number;
  alertEmailsLastHour: number;
  inQuietHours: boolean;
  /** A message held over quiet hours being released: quiet hours do not apply again. */
  releasedFromHold: boolean;
  /** The transport can hold this payload (email or SMS without attachments). */
  holdable: boolean;
};

export type GuardDecision =
  | { decision: "ALLOWED" }
  | { decision: "SUPPRESSED"; reason: SuppressionReason }
  | { decision: "HELD"; reason: "QUIET_HOURS_HELD" };

const PAUSE_REASON: Record<PauseHit, SuppressionReason> = {
  TYPE: "PAUSED_TYPE",
  RECIPIENT: "PAUSED_RECIPIENT",
  SUBJECT: "PAUSED_SUBJECT",
};

export function decideOutbound(facts: GuardFacts, limits: SafeguardLimits): GuardDecision {
  const security = facts.messageClass === "SECURITY";
  const alert = facts.messageClass === "ALERT";
  const group = limits[limitGroupFor(facts.transport)];

  if (facts.recipientInactive && !security) return { decision: "SUPPRESSED", reason: "INACTIVE_ACCOUNT" };
  if (facts.emergencyStop && !security) return { decision: "SUPPRESSED", reason: "EMERGENCY_STOP" };
  if (facts.pause && !security && !alert) return { decision: "SUPPRESSED", reason: PAUSE_REASON[facts.pause] };
  // Every class, security included: an identical message twice is never useful.
  if (facts.duplicateRecently) return { decision: "SUPPRESSED", reason: "DUPLICATE" };
  if (facts.sameSubjectRecently && (facts.messageClass === "NORMAL" || facts.messageClass === "BULK")) {
    return { decision: "SUPPRESSED", reason: "SAME_SUBJECT" };
  }
  if (alert) {
    if (facts.transport === "EMAIL" && facts.alertEmailsLastHour >= limits.alertEmailsPerHour) return { decision: "SUPPRESSED", reason: "ALERT_LIMIT" };
    return { decision: "ALLOWED" };
  }
  if (!security) {
    if (facts.sentLastHour >= group.perHour) return { decision: "SUPPRESSED", reason: "CAPPED_HOURLY" };
    if (facts.sentLastDay >= group.perDay) return { decision: "SUPPRESSED", reason: "CAPPED_DAILY" };
  }
  if (facts.inQuietHours && facts.recipientIsStaff && !facts.releasedFromHold && facts.quietPolicy !== "EXEMPT") {
    if (facts.quietPolicy === "HOLD" && facts.holdable) return { decision: "HELD", reason: "QUIET_HOURS_HELD" };
    return { decision: "SUPPRESSED", reason: "QUIET_HOURS" };
  }
  return { decision: "ALLOWED" };
}

function minutesOf(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

/** Is a local wall-clock time inside quiet hours (a window may cross midnight)? */
export function isInQuietHours(localHour: number, localMinute: number, quiet: SafeguardLimits["quietHours"]): boolean {
  if (!quiet.enabled) return false;
  const now = localHour * 60 + localMinute;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
