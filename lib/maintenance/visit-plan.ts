/**
 * A SCHEDULED MAINTENANCE VISIT — someone is coming to the property.
 *
 * `PropertyMaintenanceItem` already models a broken thing: what it is, what it
 * would cost, whether it has been fixed. This is the other half — a contractor
 * arriving at a time — which is a different question with different
 * consequences, and almost all of those consequences land on the CLEANER rather
 * than on the item. A plumber at 10am is not really a maintenance record; it is
 * a fact about that day's clean.
 *
 * So the fields are chosen around what the cleaner will actually ask when
 * someone knocks: who is this, do I let them in, how long will they be, can I
 * work around them, which rooms will be unusable, and should I clean before or
 * after. Everything the client is asked for maps to one of those.
 *
 * WHY A JSON BLOB rather than a dozen columns: the same reason the job meta is
 * one. This is a description that will grow as the business learns what it
 * needs to ask, and each new question would otherwise be a migration against a
 * live table. The blob is validated on the way in and on the way out — Json in
 * the database does not mean unvalidated in the application.
 *
 * NO COST FIELD, deliberately. A VA must never commit spend, and a cost box on
 * their screen invites exactly that. Cost stays on the admin's item.
 *
 * PURE — no DB, no I/O.
 */

import { sydneyDateKey } from "@/lib/time/sydney-range";

/** How the contractor gets in. The cleaner's most urgent question. */
export type VisitAccessMethod =
  | "CLEANER_LETS_IN"
  | "LOCKBOX"
  | "CLIENT_MEETING"
  | "CONTRACTOR_HAS_KEY";

/** Whether the clean and the visit can share the property. */
export type VisitCleanerPresence = "REQUIRED" | "NOT_REQUIRED" | "WORK_AROUND";

/** Where the clean sits relative to the work. */
export type VisitCleanTiming = "BEFORE" | "AFTER" | "UNAFFECTED";

export interface MaintenanceVisitPlan {
  /** ISO. The start of the window the contractor is expected in. */
  startAt: string;
  /** ISO. The end of that window. Optional — "some time Tuesday" is real. */
  endAt?: string;
  /** How long the work itself should take, once they are there. */
  expectedMinutes?: number;
  contractorName?: string;
  contractorPhone?: string;
  accessMethod: VisitAccessMethod;
  cleanerPresence: VisitCleanerPresence;
  cleanTiming: VisitCleanTiming;
  /** Rooms or areas that may be unusable, or dirty afterwards. */
  areasAffected: string[];
  /** What the cleaner should do about it, in the client's own words. */
  cleanerInstructions?: string;
  /** Anything else about the day. */
  dayNotes?: string;
  /** Who to ring when it goes wrong. Not necessarily the client. */
  dayContactName?: string;
  dayContactPhone?: string;
  /** Remind the cleaner and the office on the morning. */
  remindOnDay: boolean;
}

const ACCESS_METHODS: VisitAccessMethod[] = [
  "CLEANER_LETS_IN",
  "LOCKBOX",
  "CLIENT_MEETING",
  "CONTRACTOR_HAS_KEY",
];
const PRESENCES: VisitCleanerPresence[] = ["REQUIRED", "NOT_REQUIRED", "WORK_AROUND"];
const CLEAN_TIMINGS: VisitCleanTiming[] = ["BEFORE", "AFTER", "UNAFFECTED"];

/** Longest sane visit. Guards a typo turning 30 minutes into 30 days. */
const MAX_EXPECTED_MINUTES = 24 * 60;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/**
 * Read a stored blob into a plan, or null if it is not one.
 *
 * Null rather than a partial: a visit missing its start time is not a visit,
 * and showing half of one to a cleaner is worse than showing none — they would
 * plan around a fact that is not there.
 */
export function parseVisitPlan(raw: unknown): MaintenanceVisitPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  const startAt = isoOrNull(row.startAt);
  if (!startAt) return null;

  const endAt = isoOrNull(row.endAt);
  const rawMinutes = Number(row.expectedMinutes);
  const expectedMinutes =
    Number.isFinite(rawMinutes) && rawMinutes > 0
      ? Math.min(Math.round(rawMinutes), MAX_EXPECTED_MINUTES)
      : undefined;

  const areas = Array.isArray(row.areasAffected)
    ? row.areasAffected
        .map((area) => text(area, 80))
        .filter((area): area is string => Boolean(area))
        .slice(0, 20)
    : [];

  const contractorName = text(row.contractorName, 120);
  const contractorPhone = text(row.contractorPhone, 40);
  const cleanerInstructions = text(row.cleanerInstructions, 2000);
  const dayNotes = text(row.dayNotes, 2000);
  const dayContactName = text(row.dayContactName, 120);
  const dayContactPhone = text(row.dayContactPhone, 40);

  return {
    startAt,
    // An end before the start is a data-entry slip, not a window. Dropping it
    // leaves a valid single-point visit rather than an impossible range.
    ...(endAt && new Date(endAt) > new Date(startAt) ? { endAt } : {}),
    ...(expectedMinutes ? { expectedMinutes } : {}),
    ...(contractorName ? { contractorName } : {}),
    ...(contractorPhone ? { contractorPhone } : {}),
    accessMethod: ACCESS_METHODS.includes(row.accessMethod as VisitAccessMethod)
      ? (row.accessMethod as VisitAccessMethod)
      : // The safe default: assume nobody has arranged entry, so the cleaner
        // expects to be asked rather than being surprised at the door.
        "CLEANER_LETS_IN",
    cleanerPresence: PRESENCES.includes(row.cleanerPresence as VisitCleanerPresence)
      ? (row.cleanerPresence as VisitCleanerPresence)
      : "WORK_AROUND",
    cleanTiming: CLEAN_TIMINGS.includes(row.cleanTiming as VisitCleanTiming)
      ? (row.cleanTiming as VisitCleanTiming)
      : "UNAFFECTED",
    areasAffected: areas,
    ...(cleanerInstructions ? { cleanerInstructions } : {}),
    ...(dayNotes ? { dayNotes } : {}),
    ...(dayContactName ? { dayContactName } : {}),
    ...(dayContactPhone ? { dayContactPhone } : {}),
    remindOnDay: row.remindOnDay === true,
  };
}

/** Does this visit fall on the same Sydney day as a job? */
export function visitIsOnDay(plan: MaintenanceVisitPlan, day: Date): boolean {
  return sydneyDateKey(new Date(plan.startAt)) === sydneyDateKey(day);
}

const ACCESS_LABEL: Record<VisitAccessMethod, string> = {
  CLEANER_LETS_IN: "You need to let them in",
  LOCKBOX: "They have the lockbox code",
  CLIENT_MEETING: "The client is meeting them",
  CONTRACTOR_HAS_KEY: "They have their own key",
};

const PRESENCE_LABEL: Record<VisitCleanerPresence, string> = {
  REQUIRED: "Stay on site while they work",
  NOT_REQUIRED: "You do not need to be here for it",
  WORK_AROUND: "Work around them",
};

const TIMING_LABEL: Record<VisitCleanTiming, string> = {
  BEFORE: "Clean BEFORE they arrive",
  AFTER: "Clean AFTER they finish",
  UNAFFECTED: "The clean is unaffected",
};

export interface VisitBriefing {
  title: string;
  /** The lines the cleaner reads, already ordered by what matters most. */
  lines: string[];
}

/**
 * What the cleaner is told when a visit lands on their job.
 *
 * Ordered by what changes their day soonest: when, then whether they have to
 * open the door, then whether the clean can proceed at all, then the detail.
 * Anything empty is simply absent — a briefing padded with "not specified" is
 * a briefing people stop reading.
 */
export function describeVisitForCleaner(
  plan: MaintenanceVisitPlan,
  itemTitle: string
): VisitBriefing {
  const lines: string[] = [];

  const when = formatSydneyTime(new Date(plan.startAt));
  const until = plan.endAt ? formatSydneyTime(new Date(plan.endAt)) : null;
  lines.push(until ? `Expected between ${when} and ${until}` : `Expected around ${when}`);

  if (plan.expectedMinutes) {
    lines.push(`Should take about ${formatDuration(plan.expectedMinutes)}`);
  }

  lines.push(ACCESS_LABEL[plan.accessMethod]);
  lines.push(TIMING_LABEL[plan.cleanTiming]);
  lines.push(PRESENCE_LABEL[plan.cleanerPresence]);

  if (plan.areasAffected.length > 0) {
    lines.push(`Affects: ${plan.areasAffected.join(", ")}`);
  }
  if (plan.contractorName) {
    lines.push(
      plan.contractorPhone
        ? `Contractor: ${plan.contractorName} · ${plan.contractorPhone}`
        : `Contractor: ${plan.contractorName}`
    );
  }
  if (plan.dayContactName || plan.dayContactPhone) {
    lines.push(
      `If something goes wrong: ${[plan.dayContactName, plan.dayContactPhone]
        .filter(Boolean)
        .join(" · ")}`
    );
  }
  if (plan.cleanerInstructions) lines.push(plan.cleanerInstructions);
  if (plan.dayNotes) lines.push(plan.dayNotes);

  return { title: `Maintenance visit — ${itemTitle}`, lines };
}

function formatSydneyTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest ? `${hourPart} ${rest} min` : hourPart;
}
