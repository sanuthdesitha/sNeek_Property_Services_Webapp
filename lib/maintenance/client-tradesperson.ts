/**
 * THE CLIENT'S OWN TRADESPERSON on a client-handled maintenance item.
 *
 * A contact record the client keeps on the item: who is coming and when. It is
 * NOT a user account, NOT one of our MaintenanceWorkers, gets no login and is
 * never messaged by the system. Nothing here is a cost: the client pays their
 * tradesperson directly and that arrangement never reaches our invoices.
 *
 * When the client gives a planned date and start time, the visit is also
 * written to the item's existing `visitPlan` (lib/maintenance/visit-plan), the
 * mechanism that already briefs the cleaner on that day's job. This module
 * builds that plan; it does not invent a second one.
 *
 * PURE: no database, no I/O.
 */
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { parseVisitPlan, type MaintenanceVisitPlan, type VisitAccessMethod } from "@/lib/maintenance/visit-plan";

export const TRADESPERSON_ACCESS_METHODS: readonly VisitAccessMethod[] = [
  "CLIENT_MEETING",
  "CONTRACTOR_HAS_KEY",
  "LOCKBOX",
  "CLEANER_LETS_IN",
];

/** What the client chooses, in the client's words. */
export const TRADESPERSON_ACCESS_LABELS: Record<VisitAccessMethod, string> = {
  CLIENT_MEETING: "I (or my contact) will let them in",
  CONTRACTOR_HAS_KEY: "They have their own key",
  LOCKBOX: "I have given them the lockbox code myself",
  CLEANER_LETS_IN: "Our cleaner that day should let them in",
};

export interface ClientTradesperson {
  name: string;
  phone?: string;
  trade?: string;
  company?: string;
  note?: string;
  /** ISO instant: the start of the planned window. */
  plannedStart?: string;
  /** ISO instant: the end of the planned window (after the start). */
  plannedEnd?: string;
  accessMethod?: VisitAccessMethod;
  /** True when this plan was written to the item's visitPlan for the cleaner. */
  visitPublished: boolean;
}

/** What the client's form sends: calendar date and clock times in the organisation timezone. */
export interface ClientTradespersonInput {
  name?: unknown;
  phone?: unknown;
  trade?: unknown;
  company?: unknown;
  note?: unknown;
  /** yyyy-MM-dd, organisation calendar day. */
  plannedDate?: unknown;
  /** HH:mm, organisation time. Required with a date. */
  startTime?: unknown;
  /** HH:mm, organisation time, after the start. Optional. */
  endTime?: unknown;
  accessMethod?: unknown;
}

export type TradespersonValidation =
  | { ok: true; value: ClientTradesperson }
  | { ok: false; error: string };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]{6,40}$/;
/** A plan more than this far back is a typo, not a visit. */
const PAST_TOLERANCE_MS = 24 * 60 * 60 * 1000;
/** Nobody books a tradesperson more than a year out through this form. */
const FUTURE_LIMIT_MS = 366 * 24 * 60 * 60 * 1000;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function isAccessMethod(value: unknown): value is VisitAccessMethod {
  return typeof value === "string" && (TRADESPERSON_ACCESS_METHODS as readonly string[]).includes(value);
}

/**
 * Validate the client's form. Every refusal is a sentence the client can act
 * on. Times are read in the organisation timezone and stored as instants.
 */
export function validateTradespersonInput(input: ClientTradespersonInput, timeZone: string, now: Date): TradespersonValidation {
  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "Enter the tradesperson's name." };
  if (typeof input.name === "string" && input.name.trim().length > 120) {
    return { ok: false, error: "The name is too long (120 characters at most)." };
  }
  const phone = text(input.phone, 40);
  if (phone && !PHONE_PATTERN.test(phone)) return { ok: false, error: "The phone number can only hold digits, spaces and + ( ) - ." };
  const trade = text(input.trade, 120);
  const company = text(input.company, 120);
  const note = text(input.note, 1000);

  const plannedDate = text(input.plannedDate, 10);
  const startTime = text(input.startTime, 5);
  const endTime = text(input.endTime, 5);
  const value: ClientTradesperson = {
    name,
    ...(phone ? { phone } : {}),
    ...(trade ? { trade } : {}),
    ...(company ? { company } : {}),
    ...(note ? { note } : {}),
    visitPublished: false,
  };

  if (!plannedDate) {
    if (startTime || endTime) return { ok: false, error: "Choose the date for the times you entered, or clear the times." };
    return { ok: true, value };
  }
  if (!DATE_PATTERN.test(plannedDate)) return { ok: false, error: "Choose a valid planned date." };
  if (!startTime || !TIME_PATTERN.test(startTime)) return { ok: false, error: "Add the time they are expected from, so the cleaner that day knows." };
  if (endTime && !TIME_PATTERN.test(endTime)) return { ok: false, error: "Enter a valid end time, or leave it empty." };

  const start = fromZonedTime(`${plannedDate}T${startTime}:00`, timeZone);
  if (Number.isNaN(start.getTime())) return { ok: false, error: "Choose a valid planned date." };
  // fromZonedTime accepts impossible dates (2026-02-31) by rolling over; refuse them.
  if (formatInTimeZone(start, timeZone, "yyyy-MM-dd") !== plannedDate) return { ok: false, error: "Choose a valid planned date." };
  if (start.getTime() < now.getTime() - PAST_TOLERANCE_MS) return { ok: false, error: "The planned date is in the past. Choose today or a later day." };
  if (start.getTime() > now.getTime() + FUTURE_LIMIT_MS) return { ok: false, error: "The planned date is more than a year away." };

  let end: Date | null = null;
  if (endTime) {
    end = fromZonedTime(`${plannedDate}T${endTime}:00`, timeZone);
    if (end.getTime() <= start.getTime()) return { ok: false, error: "The end time must be after the start time." };
  }
  const accessMethod = isAccessMethod(input.accessMethod) ? input.accessMethod : "CLIENT_MEETING";
  return {
    ok: true,
    value: {
      ...value,
      plannedStart: start.toISOString(),
      ...(end ? { plannedEnd: end.toISOString() } : {}),
      accessMethod,
    },
  };
}

function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** Read a stored blob, or null when it is not a tradesperson (no name). */
export function parseClientTradesperson(raw: unknown): ClientTradesperson | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const name = text(row.name, 120);
  if (!name) return null;
  const phone = text(row.phone, 40);
  const trade = text(row.trade, 120);
  const company = text(row.company, 120);
  const note = text(row.note, 1000);
  const plannedStart = isoOrUndefined(row.plannedStart);
  const plannedEnd = plannedStart ? isoOrUndefined(row.plannedEnd) : undefined;
  return {
    name,
    ...(phone ? { phone } : {}),
    ...(trade ? { trade } : {}),
    ...(company ? { company } : {}),
    ...(note ? { note } : {}),
    ...(plannedStart ? { plannedStart } : {}),
    ...(plannedEnd && plannedStart && plannedEnd > plannedStart ? { plannedEnd } : {}),
    ...(plannedStart && isAccessMethod(row.accessMethod) ? { accessMethod: row.accessMethod } : {}),
    visitPublished: row.visitPublished === true && Boolean(plannedStart),
  };
}

/**
 * The visit plan the cleaner is briefed with, built from the client's plan.
 * Null when there is no planned start. Carries no cost and no access code:
 * the access line only says how the tradesperson gets in.
 */
export function visitPlanFromTradesperson(person: ClientTradesperson, area: string | null): MaintenanceVisitPlan | null {
  if (!person.plannedStart) return null;
  const by = [person.trade, person.company].filter(Boolean).join(", ");
  return parseVisitPlan({
    startAt: person.plannedStart,
    endAt: person.plannedEnd,
    contractorName: person.name,
    contractorPhone: person.phone,
    accessMethod: person.accessMethod ?? "CLIENT_MEETING",
    cleanerPresence: "WORK_AROUND",
    cleanTiming: "UNAFFECTED",
    areasAffected: area ? [area] : [],
    dayNotes: by ? `Arranged by the client (${by}).` : "Arranged by the client.",
    remindOnDay: false,
  });
}

/** True when the planned window differs between two versions (office is told about date changes). */
export function plannedWindowChanged(before: ClientTradesperson | null, after: ClientTradesperson | null): boolean {
  return (before?.plannedStart ?? null) !== (after?.plannedStart ?? null) || (before?.plannedEnd ?? null) !== (after?.plannedEnd ?? null);
}
