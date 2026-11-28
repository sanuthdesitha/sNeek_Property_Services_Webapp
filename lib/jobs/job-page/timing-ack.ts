/**
 * Did each cleaner acknowledge the job's guest-timing rules when they started?
 *
 * The start briefing (lib/forms/start-briefing.ts) makes a cleaner tap
 * through every item, timing rules first, before the clock starts, and
 * stores `startBriefingAcks[userId] = { hash, items: [{ itemId, at }] }` in
 * the job meta. This reads that record for the admin job page. It is evidence,
 * so it is read strictly:
 *
 *   - a missing record is "not acknowledged yet", never assumed;
 *   - a record whose fingerprint differs from the current briefing was given
 *     for an EARLIER version (the time, or another item, changed since) and
 *     does not count for the rule as it stands now;
 *   - a record that is present but malformed is "could not be read".
 *
 * `startConfirmation` (property code and laundry bag) is a different gate and
 * is deliberately not read as a timing acknowledgement.
 *
 * PURE: no DB, no I/O.
 */
import type { PropertyReminderSource } from "@/lib/properties/property-reminders";
import {
  resolveStartBriefingItems,
  startBriefingHash,
  startBriefingTimingHash,
  type ResolvedStartBriefingItem,
  type StartBriefingJobTask,
} from "@/lib/forms/start-briefing";
import type { JobMeta } from "@/lib/jobs/meta";
import { formatAckTime } from "./briefing";

export type TimingAckState =
  /** Every current timing item ticked, against the current briefing. */
  | { kind: "acknowledged"; atLabel: string | null }
  /** Ticked, but for a briefing that has changed since. Not counted. */
  | { kind: "earlierVersion"; atLabel: string | null }
  | { kind: "notAcknowledged" }
  /** A record exists but its shape cannot be read. */
  | { kind: "unreadable" };

export type TimingAckRow = { userId: string; name: string; assigned: boolean; state: TimingAckState };

export type TimingAckSummary =
  /** The job carries no timing rule: nothing to acknowledge. */
  | { kind: "none" }
  | { kind: "rows"; rows: TimingAckRow[] }
  /** The record could not be read at all (shown as such, never as acknowledged). */
  | { kind: "error" };

export type TimingAckCleaner = { userId: string; name: string };

type AckMeta = Pick<
  JobMeta,
  "earlyCheckin" | "lateCheckout" | "internalNoteText" | "specialRequestTasks" | "notices" | "startBriefingAcks"
>;

type ParsedAck =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "record"; hash: string | null; timingHash: string | null; entries: Map<string, string | null> };

function parseAck(raw: unknown): ParsedAck {
  if (raw === undefined || raw === null) return { kind: "missing" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { kind: "unreadable" };
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.items)) return { kind: "unreadable" };
  const entries = new Map<string, string | null>();
  for (const item of record.items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const itemId = typeof entry.itemId === "string" ? entry.itemId.trim() : "";
    if (!itemId) continue;
    entries.set(itemId, typeof entry.at === "string" && entry.at.trim() ? entry.at.trim() : null);
  }
  const hash = typeof record.hash === "string" && record.hash.trim() ? record.hash.trim() : null;
  const timingHash = typeof record.timingHash === "string" && record.timingHash.trim() ? record.timingHash.trim() : null;
  return { kind: "record", hash, timingHash, entries };
}

/** The latest tap among the timing items, formatted in the organisation timezone. */
function latestTapLabel(entries: Map<string, string | null>, itemIds: string[], timeZone: string): string | null {
  const stamps = itemIds
    .map((id) => entries.get(id))
    .map((at) => (at ? new Date(at).getTime() : Number.NaN))
    .filter((time) => !Number.isNaN(time));
  if (stamps.length === 0) return null;
  return formatAckTime(new Date(Math.max(...stamps)).toISOString(), timeZone);
}

/** The fingerprints of the briefing as it stands now. */
type CurrentFingerprints = { hash: string; timingHash: string };

/**
 * Was the record given for the timing as it stands now? A record that carries
 * the timing-only fingerprint is compared on that, so adding an unrelated task
 * does not undo a timing confirmation. An older record without it can only be
 * compared on the whole briefing, so any edit since counts as a change.
 */
function recordMatchesTiming(ack: Extract<ParsedAck, { kind: "record" }>, current: CurrentFingerprints): boolean {
  if (ack.timingHash) return ack.timingHash === current.timingHash;
  return ack.hash === current.hash;
}

function stateFor(raw: unknown, timingIds: string[], current: CurrentFingerprints, timeZone: string): TimingAckState {
  const ack = parseAck(raw);
  if (ack.kind === "missing") return { kind: "notAcknowledged" };
  if (ack.kind === "unreadable") return { kind: "unreadable" };
  const allTicked = timingIds.every((id) => ack.entries.has(id));
  if (!allTicked) return { kind: "notAcknowledged" };
  const atLabel = latestTapLabel(ack.entries, timingIds, timeZone);
  if (!recordMatchesTiming(ack, current)) return { kind: "earlierVersion", atLabel };
  return { kind: "acknowledged", atLabel };
}

function currentFingerprints(items: ResolvedStartBriefingItem[]): CurrentFingerprints {
  return { hash: startBriefingHash(items), timingHash: startBriefingTimingHash(items) };
}

export function buildTimingAckSummary(input: {
  meta: AckMeta;
  tasks: StartBriefingJobTask[];
  /** The job's property with its features (automatic reminders), as the start gate reads it. */
  property: PropertyReminderSource;
  cleaners: TimingAckCleaner[];
  names: Map<string, string>;
  timeZone: string;
}): TimingAckSummary {
  const items = resolveStartBriefingItems({ meta: input.meta, jobTasks: input.tasks, property: input.property });
  const timingIds = items.filter((item) => item.source === "TIMING_RULE").map((item) => item.id);
  if (timingIds.length === 0) return { kind: "none" };

  const rawAcks = input.meta.startBriefingAcks;
  if (rawAcks !== undefined && rawAcks !== null && (typeof rawAcks !== "object" || Array.isArray(rawAcks))) {
    return { kind: "error" };
  }
  const acks = (rawAcks ?? {}) as Record<string, unknown>;
  const current = currentFingerprints(items);

  const rows: TimingAckRow[] = input.cleaners.map((cleaner) => ({
    userId: cleaner.userId,
    name: cleaner.name,
    assigned: true,
    state: stateFor(acks[cleaner.userId], timingIds, current, input.timeZone),
  }));
  // Someone who acknowledged and was later taken off the job: still a true record.
  const assignedIds = new Set(input.cleaners.map((cleaner) => cleaner.userId));
  for (const userId of Object.keys(acks)) {
    if (!userId || assignedIds.has(userId)) continue;
    rows.push({
      userId,
      name: input.names.get(userId) ?? userId,
      assigned: false,
      state: stateFor(acks[userId], timingIds, current, input.timeZone),
    });
  }
  return { kind: "rows", rows };
}

/** One plain sentence per row for the job page. */
export function timingAckSentence(row: TimingAckRow): string {
  const who = row.assigned ? row.name : `${row.name} (no longer on this job)`;
  switch (row.state.kind) {
    case "acknowledged":
      // "the current timing", not "at start": a re-confirmation after an
      // office change (briefing-ack route) is stored the same way.
      return row.state.atLabel
        ? `${who} acknowledged the current timing · ${row.state.atLabel}`
        : `${who} acknowledged the current timing · time not recorded`;
    case "earlierVersion":
      return `${who}: not acknowledged for the current timing. Their confirmation${row.state.atLabel ? ` (${row.state.atLabel})` : ""} was for an earlier version, changed since.`;
    case "unreadable":
      return `${who}: acknowledgement could not be read`;
    default:
      return `${who}: not acknowledged yet`;
  }
}

/**
 * The signed-in cleaner's own timing acknowledgement, for their job screen.
 *
 *   none             the job has no timing rule;
 *   current          they confirmed the timing as it stands now;
 *   changed          they confirmed an earlier time, which the office changed;
 *   notAcknowledged  no confirmation is recorded;
 *   unreadable       a record exists but cannot be read (never treated as confirmed).
 */
export type OwnTimingAckStatus = "none" | "current" | "changed" | "notAcknowledged" | "unreadable";

export function ownTimingAckStatus(input: { items: ResolvedStartBriefingItem[]; rawAck: unknown }): OwnTimingAckStatus {
  const timingIds = input.items.filter((item) => item.source === "TIMING_RULE").map((item) => item.id);
  if (timingIds.length === 0) return "none";
  const state = stateFor(input.rawAck, timingIds, currentFingerprints(input.items), "UTC");
  switch (state.kind) {
    case "acknowledged":
      return "current";
    case "earlierVersion":
      return "changed";
    case "unreadable":
      return "unreadable";
    default:
      return "notAcknowledged";
  }
}
