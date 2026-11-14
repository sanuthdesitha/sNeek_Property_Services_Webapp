/**
 * Sending safeguards: the limits, their safe bounds and the suppression
 * reasons. Pure and dependency-free so the screen, the routes, the gate and
 * the tests share one definition.
 *
 * Every default here is "pending owner confirmation" (docs/SYSTEM.md, Sending
 * safeguards). They were chosen to sit well above a normal operational day:
 * a cleaner on six jobs receives roughly 25-30 automatic emails across offers,
 * reminders, QA results and changes; an administrator receives more, but in
 * bursts (iCal, stock). The ceilings stop a loop, not a busy day.
 */

/** Transports the guard sees. The inbox is never capped and never passes here. */
export const GUARDED_TRANSPORTS = ["EMAIL", "SMS", "WEB_PUSH", "MOBILE_PUSH"] as const;
export type GuardedTransport = (typeof GUARDED_TRANSPORTS)[number];

/** Browser and phone push share one set of limits ("push"). */
export const LIMIT_GROUPS = ["EMAIL", "SMS", "PUSH"] as const;
export type LimitGroup = (typeof LIMIT_GROUPS)[number];

export function limitGroupFor(transport: GuardedTransport): LimitGroup {
  return transport === "WEB_PUSH" || transport === "MOBILE_PUSH" ? "PUSH" : transport;
}

export function transportsInGroup(group: LimitGroup): GuardedTransport[] {
  return group === "PUSH" ? ["WEB_PUSH", "MOBILE_PUSH"] : [group];
}

export const LIMIT_GROUP_LABEL: Record<LimitGroup, string> = { EMAIL: "Email", SMS: "SMS", PUSH: "Push" };

export type GroupLimits = {
  /** Messages one person may receive on this transport in a rolling hour (all types). */
  perHour: number;
  /** Messages one person may receive on this transport in a rolling 24 hours (all types). */
  perDay: number;
  /** The same type to the same person about the same subject at most once per this many minutes. */
  sameSubjectMinutes: number;
  /** Attempts to one person in the breaker window that trip the breaker for that person. */
  breakerPerRecipient: number;
};

export type QuietHours = {
  enabled: boolean;
  /** Local "HH:MM" in the organisation timezone. */
  start: string;
  end: string;
};

export type SafeguardLimits = {
  EMAIL: GroupLimits;
  SMS: GroupLimits;
  PUSH: GroupLimits;
  /** Identical content to the same person on the same transport is dropped within this window. */
  duplicateWindowMinutes: number;
  /** Short window the circuit breaker counts attempts in. */
  breakerWindowMinutes: number;
  /** Attempts of one type (all recipients, one transport) in the window that pause the type. */
  breakerPerType: number;
  /** Attempts about one subject (a job, a laundry task) in the window that pause that subject. */
  breakerPerSubject: number;
  /** A single send naming more recipients than this is refused whole. */
  maxRecipientsPerSend: number;
  /** Safeguard alert emails to administrators, at most this many per hour in total. */
  alertEmailsPerHour: number;
  quietHours: QuietHours;
};

export type EmergencyStop = {
  on: boolean;
  changedAt: string | null;
  changedById: string | null;
  reason: string | null;
};

export type SafeguardSettings = {
  limits: SafeguardLimits;
  emergencyStop: EmergencyStop;
  updatedAt: string | null;
};

export const DEFAULT_SAFEGUARD_LIMITS: SafeguardLimits = {
  EMAIL: { perHour: 15, perDay: 50, sameSubjectMinutes: 30, breakerPerRecipient: 12 },
  SMS: { perHour: 6, perDay: 15, sameSubjectMinutes: 60, breakerPerRecipient: 6 },
  PUSH: { perHour: 30, perDay: 120, sameSubjectMinutes: 5, breakerPerRecipient: 30 },
  duplicateWindowMinutes: 720,
  breakerWindowMinutes: 15,
  breakerPerType: 200,
  breakerPerSubject: 40,
  maxRecipientsPerSend: 25,
  alertEmailsPerHour: 6,
  quietHours: { enabled: true, start: "21:00", end: "07:00" },
};

export const DEFAULT_EMERGENCY_STOP: EmergencyStop = { on: false, changedAt: null, changedById: null, reason: null };

export const DEFAULT_SAFEGUARD_SETTINGS: SafeguardSettings = {
  limits: DEFAULT_SAFEGUARD_LIMITS,
  emergencyStop: DEFAULT_EMERGENCY_STOP,
  updatedAt: null,
};

type Bound = { min: number; max: number };

/**
 * Safe bounds. A minimum keeps a limit from blocking ordinary operational
 * messages (no ceiling below a busy day); a maximum keeps a limit meaningful.
 */
export const GROUP_LIMIT_BOUNDS: Record<LimitGroup, Record<keyof GroupLimits, Bound>> = {
  EMAIL: { perHour: { min: 5, max: 60 }, perDay: { min: 20, max: 300 }, sameSubjectMinutes: { min: 5, max: 240 }, breakerPerRecipient: { min: 6, max: 100 } },
  SMS: { perHour: { min: 2, max: 30 }, perDay: { min: 5, max: 100 }, sameSubjectMinutes: { min: 5, max: 240 }, breakerPerRecipient: { min: 3, max: 50 } },
  PUSH: { perHour: { min: 10, max: 200 }, perDay: { min: 40, max: 1000 }, sameSubjectMinutes: { min: 1, max: 120 }, breakerPerRecipient: { min: 10, max: 300 } },
};

export const LIMIT_BOUNDS: Record<Exclude<keyof SafeguardLimits, LimitGroup | "quietHours">, Bound> = {
  duplicateWindowMinutes: { min: 10, max: 2880 },
  breakerWindowMinutes: { min: 5, max: 120 },
  breakerPerType: { min: 50, max: 5000 },
  breakerPerSubject: { min: 10, max: 500 },
  maxRecipientsPerSend: { min: 5, max: 200 },
  alertEmailsPerHour: { min: 1, max: 30 },
};

export const GROUP_LIMIT_LABEL: Record<keyof GroupLimits, string> = {
  perHour: "Per person per hour",
  perDay: "Per person per day",
  sameSubjectMinutes: "Same type and subject, once per (minutes)",
  breakerPerRecipient: "Breaker: attempts to one person in the window",
};

export const LIMIT_LABEL: Record<keyof typeof LIMIT_BOUNDS, string> = {
  duplicateWindowMinutes: "Identical message dropped within (minutes)",
  breakerWindowMinutes: "Breaker window (minutes)",
  breakerPerType: "Breaker: attempts of one type in the window",
  breakerPerSubject: "Breaker: attempts about one job or subject in the window",
  maxRecipientsPerSend: "Most recipients in one send",
  alertEmailsPerHour: "Safeguard alert emails per hour (all administrators)",
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function clampInt(value: unknown, bound: Bound, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(bound.max, Math.max(bound.min, Math.round(number)));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeGroup(group: LimitGroup, raw: unknown): GroupLimits {
  const source = record(raw);
  const bounds = GROUP_LIMIT_BOUNDS[group];
  const fallback = DEFAULT_SAFEGUARD_LIMITS[group];
  const perHour = clampInt(source.perHour, bounds.perHour, fallback.perHour);
  // A daily ceiling below the hourly one would make the hourly one meaningless.
  const perDay = Math.max(perHour, clampInt(source.perDay, bounds.perDay, fallback.perDay));
  return {
    perHour,
    perDay,
    sameSubjectMinutes: clampInt(source.sameSubjectMinutes, bounds.sameSubjectMinutes, fallback.sameSubjectMinutes),
    breakerPerRecipient: clampInt(source.breakerPerRecipient, bounds.breakerPerRecipient, fallback.breakerPerRecipient),
  };
}

function normalizeQuietHours(raw: unknown): QuietHours {
  const source = record(raw);
  const fallback = DEFAULT_SAFEGUARD_LIMITS.quietHours;
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    start: typeof source.start === "string" && TIME_PATTERN.test(source.start) ? source.start : fallback.start,
    end: typeof source.end === "string" && TIME_PATTERN.test(source.end) ? source.end : fallback.end,
  };
}

/** Stored or submitted limits, clamped into their safe bounds; unknown keys dropped. */
export function normalizeSafeguardLimits(raw: unknown): SafeguardLimits {
  const source = record(raw);
  const scalar = (key: keyof typeof LIMIT_BOUNDS) => clampInt(source[key], LIMIT_BOUNDS[key], DEFAULT_SAFEGUARD_LIMITS[key]);
  return {
    EMAIL: normalizeGroup("EMAIL", source.EMAIL),
    SMS: normalizeGroup("SMS", source.SMS),
    PUSH: normalizeGroup("PUSH", source.PUSH),
    duplicateWindowMinutes: scalar("duplicateWindowMinutes"),
    breakerWindowMinutes: scalar("breakerWindowMinutes"),
    breakerPerType: scalar("breakerPerType"),
    breakerPerSubject: scalar("breakerPerSubject"),
    maxRecipientsPerSend: scalar("maxRecipientsPerSend"),
    alertEmailsPerHour: scalar("alertEmailsPerHour"),
    quietHours: normalizeQuietHours(source.quietHours),
  };
}

export function normalizeEmergencyStop(raw: unknown): EmergencyStop {
  const source = record(raw);
  return {
    on: source.on === true,
    changedAt: typeof source.changedAt === "string" ? source.changedAt : null,
    changedById: typeof source.changedById === "string" ? source.changedById : null,
    reason: typeof source.reason === "string" ? source.reason.slice(0, 300) : null,
  };
}

export function normalizeSafeguardSettings(raw: unknown): SafeguardSettings {
  const source = record(raw);
  return {
    limits: normalizeSafeguardLimits(source.limits),
    emergencyStop: normalizeEmergencyStop(source.emergencyStop),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null,
  };
}

/**
 * A submitted value outside its bounds is refused rather than silently
 * clamped, so an administrator never believes they saved a number they did not.
 */
export function limitsOutOfBounds(raw: unknown): string[] {
  const source = record(raw);
  const problems: string[] = [];
  for (const group of LIMIT_GROUPS) {
    const values = record(source[group]);
    for (const key of Object.keys(GROUP_LIMIT_BOUNDS[group]) as Array<keyof GroupLimits>) {
      const value = values[key];
      const bound = GROUP_LIMIT_BOUNDS[group][key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < bound.min || value > bound.max) {
        problems.push(`${LIMIT_GROUP_LABEL[group]}: ${GROUP_LIMIT_LABEL[key]} must be a whole number from ${bound.min} to ${bound.max}.`);
      }
    }
    const perHour = values.perHour;
    const perDay = values.perDay;
    if (typeof perHour === "number" && typeof perDay === "number" && perDay < perHour) {
      problems.push(`${LIMIT_GROUP_LABEL[group]}: the daily limit cannot be lower than the hourly limit.`);
    }
  }
  for (const key of Object.keys(LIMIT_BOUNDS) as Array<keyof typeof LIMIT_BOUNDS>) {
    const value = source[key];
    const bound = LIMIT_BOUNDS[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < bound.min || value > bound.max) {
      problems.push(`${LIMIT_LABEL[key]} must be a whole number from ${bound.min} to ${bound.max}.`);
    }
  }
  const quiet = record(source.quietHours);
  if (typeof quiet.enabled !== "boolean") problems.push("Quiet hours must be on or off.");
  if (typeof quiet.start !== "string" || !TIME_PATTERN.test(quiet.start)) problems.push("Quiet hours start must be a time like 21:00.");
  if (typeof quiet.end !== "string" || !TIME_PATTERN.test(quiet.end)) problems.push("Quiet hours end must be a time like 07:00.");
  return problems;
}

/** Why a message was not sent (or held). Stored on OutboundMessageEvent.reason. */
export const SUPPRESSION_REASONS = [
  "EMERGENCY_STOP",
  "PAUSED_TYPE",
  "PAUSED_RECIPIENT",
  "PAUSED_SUBJECT",
  "DUPLICATE",
  "SAME_SUBJECT",
  "CAPPED_HOURLY",
  "CAPPED_DAILY",
  "QUIET_HOURS",
  "QUIET_HOURS_HELD",
  "HELD_EXPIRED",
  "TOO_MANY_RECIPIENTS",
  "INACTIVE_ACCOUNT",
  "ALERT_LIMIT",
  "SAFEGUARD_UNAVAILABLE",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const SUPPRESSION_REASON_LABEL: Record<SuppressionReason, string> = {
  EMERGENCY_STOP: "emergency stop is on",
  PAUSED_TYPE: "this notification type is paused",
  PAUSED_RECIPIENT: "sending to this person is paused",
  PAUSED_SUBJECT: "messages about this job or subject are paused",
  DUPLICATE: "identical message already sent recently",
  SAME_SUBJECT: "same type and subject already sent recently",
  CAPPED_HOURLY: "hourly limit for this person reached",
  CAPPED_DAILY: "daily limit for this person reached",
  QUIET_HOURS: "quiet hours (dropped; the inbox copy remains)",
  QUIET_HOURS_HELD: "quiet hours (held, sent once after quiet hours)",
  HELD_EXPIRED: "held over quiet hours and no longer relevant",
  TOO_MANY_RECIPIENTS: "too many recipients in one send",
  INACTIVE_ACCOUNT: "the account is disabled",
  ALERT_LIMIT: "safeguard alert email limit reached",
  SAFEGUARD_UNAVAILABLE: "the safeguards could not be checked",
};

/** The text callers store as the error of a suppressed message: never "sent". */
export function notSentText(reason: SuppressionReason): string {
  return `Not sent (sending safeguard): ${SUPPRESSION_REASON_LABEL[reason]}.`;
}

export function isSuppressionReason(value: unknown): value is SuppressionReason {
  return typeof value === "string" && (SUPPRESSION_REASONS as readonly string[]).includes(value);
}
