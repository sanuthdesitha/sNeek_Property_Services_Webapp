/**
 * SMART PROPERTY REMINDERS (cleaner job flow v2, item 9, 2026-11-28; pilot
 * "Property reminders").
 *
 * A reminder is short text + a moment + a scope + a lifetime:
 *   moment    BEFORE_START (start briefing, acknowledged before clock-in),
 *             ROOM (top of that room's section), BEFORE_LEAVING (wrap up).
 *   scope     one property, optionally one cleaner.
 *   lifetime  every job / the next N jobs / until a date (inclusive).
 *
 * This module is PURE: the shapes, whether a reminder applies to a job, and
 * the plan for one job (caps: 5 before start, 3 per room, the rest under
 * "More notes", most important and newest first). Database reads live in
 * lib/properties/reminders/load.ts.
 *
 * Every reminder states why it exists (`why`), so nothing reaches a cleaner
 * as an unexplained instruction. No AI writes or chooses reminders.
 */
import { firstSectionByRoom, isReminderRoomKey, type ReminderRoomKey, type ReminderSchemaSection } from "./sections";

export const REMINDER_MOMENTS = ["BEFORE_START", "ROOM", "BEFORE_LEAVING"] as const;
export type ReminderMoment = (typeof REMINDER_MOMENTS)[number];
export const REMINDER_MOMENT_LABEL: Record<ReminderMoment, string> = {
  BEFORE_START: "Before start",
  ROOM: "In a room",
  BEFORE_LEAVING: "Before leaving",
};

export const REMINDER_LIFETIMES = ["EVERY_JOB", "NEXT_JOBS", "UNTIL_DATE"] as const;
export type ReminderLifetime = (typeof REMINDER_LIFETIMES)[number];

export const BEFORE_START_CAP = 5;
export const PER_ROOM_CAP = 3;
export const REMINDER_TEXT_MAX = 280;
export const NEXT_JOBS_MAX = 20;

/** Briefing item ids start with this (lib/properties/property-reminders.ts isPropertyReminderId). */
export const OFFICE_REMINDER_ITEM_PREFIX = "property-reminder-office-";

export function officeReminderKey(id: string): string {
  return `office:${id}`;
}

/** One reminder as the cleaner's job sees it, already decided for this job and person. */
export type ReminderItem = {
  /** Stable across reads: "office:<id>" or "rule:<rule>:<evidence>". Claims and confirmations use it. */
  key: string;
  /** The id in the start briefing (part of its acknowledgement fingerprint). */
  briefingId: string;
  text: string;
  /** Why it exists, in plain words (the facts). */
  why: string;
  moment: ReminderMoment;
  roomKey: ReminderRoomKey | null;
  mustConfirm: boolean;
  /** Higher first when capping (rules use it for severity; office reminders 1). */
  rank: number;
  /** ISO; newer first within the same rank. */
  createdAt: string;
};

/** A stored or computed reminder before it is decided for one job. */
export type ReminderCandidate = ReminderItem & {
  cleanerId: string | null;
  lifetime: ReminderLifetime;
  jobsCount: number | null;
  /** yyyy-mm-dd, inclusive, in the organisation calendar. */
  untilDate: string | null;
  /** Jobs it was already used on (claimed at clock-in). */
  claimedJobIds: readonly string[];
};

export type ReminderJobContext = {
  /** Null for a view that is not about one job (none applies then to NEXT_JOBS, except as preview). */
  jobId: string | null;
  /** The cleaner the job screen is for; null = no person (office preview of "everyone"). */
  userId: string | null;
  /** yyyy-mm-dd today in the organisation calendar. */
  todayKey: string;
};

/**
 * Does this reminder apply to this job and person now?
 *  - one cleaner only: only that cleaner;
 *  - next N jobs: a job it was already used on keeps it; otherwise only while
 *    fewer than N jobs have used it;
 *  - until a date: through that calendar day; an unreadable date never applies.
 */
export function reminderApplies(candidate: ReminderCandidate, context: ReminderJobContext): boolean {
  if (candidate.cleanerId && candidate.cleanerId !== context.userId) return false;
  if (candidate.moment === "ROOM" && !candidate.roomKey) return false;
  switch (candidate.lifetime) {
    case "EVERY_JOB":
      return true;
    case "UNTIL_DATE":
      return Boolean(candidate.untilDate) && /^\d{4}-\d{2}-\d{2}$/.test(candidate.untilDate!) && context.todayKey <= candidate.untilDate!;
    case "NEXT_JOBS": {
      const limit = candidate.jobsCount ?? 0;
      if (limit < 1) return false;
      if (context.jobId && candidate.claimedJobIds.includes(context.jobId)) return true;
      return new Set(candidate.claimedJobIds).size < limit;
    }
    default:
      return false;
  }
}

export function toReminderItem(candidate: ReminderCandidate): ReminderItem {
  return {
    key: candidate.key,
    briefingId: candidate.briefingId,
    text: candidate.text,
    why: candidate.why,
    moment: candidate.moment,
    roomKey: candidate.roomKey,
    mustConfirm: candidate.mustConfirm,
    rank: candidate.rank,
    createdAt: candidate.createdAt,
  };
}

/** The reminders that apply to this job and person, in importance order. */
export function remindersForJob(candidates: readonly ReminderCandidate[], context: ReminderJobContext): ReminderItem[] {
  return sortReminders(candidates.filter((candidate) => reminderApplies(candidate, context)).map(toReminderItem));
}

/** Must confirm first, then higher rank, then newest, then key (deterministic). */
export function sortReminders<T extends ReminderItem>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.mustConfirm) - Number(a.mustConfirm) ||
      b.rank - a.rank ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.key.localeCompare(b.key),
  );
}

/**
 * The before-start reminders read out in the start briefing, after `fixed`
 * items already shown there (live plants): at most BEFORE_START_CAP in all;
 * the rest go under "More notes" (not part of the acknowledgement).
 */
export function splitBeforeStart(items: readonly ReminderItem[], fixedCount: number): { shown: ReminderItem[]; more: ReminderItem[] } {
  const ordered = sortReminders(items.filter((item) => item.moment === "BEFORE_START"));
  const room = Math.max(0, BEFORE_START_CAP - fixedCount);
  return { shown: ordered.slice(0, room), more: ordered.slice(room) };
}

export type RoomReminderGroup = { sectionId: string; roomKey: ReminderRoomKey; items: ReminderItem[] };

/** What the cleaner's job screen shows, beyond the start briefing. */
export type ReminderPlan = {
  /** At the top of these sections, at most PER_ROOM_CAP each. */
  rooms: RoomReminderGroup[];
  /** Wrap up, before submit. Must-confirm ones are required to submit. */
  leaving: ReminderItem[];
  /** Over the caps: listed under "More notes", nothing to confirm. */
  more: ReminderItem[];
};

/**
 * Plan the room and leaving reminders for a job's form. A room reminder whose
 * room the form lacks is not shown anywhere (never for a section the form
 * lacks). `beforeStartMore` is the overflow from the briefing.
 */
export function planJobReminders(input: {
  items: readonly ReminderItem[];
  sections: readonly ReminderSchemaSection[] | null | undefined;
  beforeStartMore?: readonly ReminderItem[];
}): ReminderPlan {
  const sectionFor = firstSectionByRoom(input.sections);
  const groups = new Map<string, RoomReminderGroup>();
  const more: ReminderItem[] = [...(input.beforeStartMore ?? [])];
  for (const item of sortReminders(input.items.filter((entry) => entry.moment === "ROOM"))) {
    if (!isReminderRoomKey(item.roomKey)) continue;
    const sectionId = sectionFor.get(item.roomKey);
    if (!sectionId) continue;
    const group = groups.get(sectionId) ?? { sectionId, roomKey: item.roomKey, items: [] };
    if (group.items.length < PER_ROOM_CAP) group.items.push(item);
    else more.push(item);
    groups.set(sectionId, group);
  }
  return {
    rooms: Array.from(groups.values()),
    leaving: sortReminders(input.items.filter((item) => item.moment === "BEFORE_LEAVING")),
    more,
  };
}

/** Must-confirm reminders in this plan that this person has not confirmed on this job. */
export function unconfirmedRequired(items: readonly ReminderItem[], confirmedKeys: ReadonlySet<string>): ReminderItem[] {
  return items.filter((item) => item.mustConfirm && !confirmedKeys.has(item.key));
}

/** "When it ends", in plain words, for the office list. */
export function describeLifetime(input: { lifetime: ReminderLifetime; jobsCount: number | null; untilDate: string | null; usedOnJobs: number }): string {
  switch (input.lifetime) {
    case "EVERY_JOB":
      return "Every job until someone ends it";
    case "UNTIL_DATE":
      return input.untilDate ? `Until ${input.untilDate} (inclusive)` : "End date could not be read: not shown";
    case "NEXT_JOBS": {
      const total = input.jobsCount ?? 0;
      const left = Math.max(0, total - input.usedOnJobs);
      if (total === 1) return left === 0 ? "Next job only: used" : "Next job only";
      return left === 0 ? `Next ${total} jobs: all used` : `Next ${total} jobs: ${left} left`;
    }
    default:
      return "Unknown";
  }
}

/** Has a reminder run its course (shown in the office list as ended)? */
export function lifetimeFinished(input: { lifetime: ReminderLifetime; jobsCount: number | null; untilDate: string | null; usedOnJobs: number; todayKey: string }): boolean {
  if (input.lifetime === "NEXT_JOBS") return input.usedOnJobs >= (input.jobsCount ?? 0);
  if (input.lifetime === "UNTIL_DATE") return !input.untilDate || input.todayKey > input.untilDate;
  return false;
}
