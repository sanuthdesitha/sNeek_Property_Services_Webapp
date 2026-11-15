/**
 * Deep-clean scheduling queue (board "Deep clean", 2026-11-16): shapes and
 * the pure rules that turn a stored plan into a queue row. Plain module (no
 * server imports): the server reader, routes, screen and tests share it.
 *
 * The scheduling rule is NOT here and is not changed: verify a completed deep
 * clean → due three Sydney calendar months later (DEEP_CLEAN_CADENCE_MONTHS)
 * → an undated proposal on the due day (daily check 08:15) → an administrator
 * chooses the day → one draft Deep clean job. This module only reads the
 * plan the rule wrote.
 */

export type QueueState =
  | "needs_date"
  | "evidence_changed"
  | "awaiting_check"
  | "due_later"
  | "draft_created"
  | "needs_review";

export const QUEUE_STATE_WORDS: Record<QueueState, string> = {
  needs_date: "Needs a date",
  evidence_changed: "Evidence changed",
  awaiting_check: "Due · next daily check",
  due_later: "Due later",
  draft_created: "Draft job",
  needs_review: "Needs office review",
};

/** The parts of a stored plan the queue reads (lib/properties/deep-clean-planning.ts). */
export type PlanSnapshot = {
  revision: number;
  baseline: null | { jobId: string; completedDay: string; dueDay: string; verifiedBy: string; verifiedAt: string };
  proposal: null | { id: string; status: "NEEDS_SCHEDULING" | "DEFERRED" | "SCHEDULED" | "SUPERSEDED"; dueDay: string; jobId: string | null; scheduledDay: string | null; scheduledBy: string | null; createdAt: string };
  history: Array<{ id: string; status: string; dueDay: string; jobId: string | null; scheduledDay: string | null; createdAt: string; baselineJobId: string }>;
};

export function queueStateFor(plan: PlanSnapshot | null, baselineCurrent: boolean, today: string): QueueState | null {
  if (!plan) return "needs_review";
  if (plan.proposal?.status === "SCHEDULED") return "draft_created";
  if (!plan.baseline) return null;
  if (!baselineCurrent) return "evidence_changed";
  if (plan.proposal?.status === "NEEDS_SCHEDULING") return "needs_date";
  if (plan.baseline.dueDay > today) return "due_later";
  // Due, but the daily check has not made the proposal yet.
  return "awaiting_check";
}

/** Whole days between two calendar days (YYYY-MM-DD), b − a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export type DueBand = "overdue" | "today" | null;

export function dueBand(state: QueueState | null, dueDay: string | null, today: string): DueBand {
  if (!dueDay || (state !== "needs_date" && state !== "awaiting_check" && state !== "evidence_changed")) return null;
  if (dueDay < today) return "overdue";
  if (dueDay === today) return "today";
  return null;
}

export function dueWords(dueDay: string | null, today: string): string | null {
  if (!dueDay) return null;
  const days = daysBetween(dueDay, today);
  if (days > 0) return `Due ${days} ${days === 1 ? "day" : "days"} ago`;
  if (days === 0) return "Due today";
  return null;
}

export type QueueRow = {
  propertyId: string;
  propertyName: string;
  clientName: string | null;
  suburb: string;
  bedrooms: number | null;
  state: QueueState;
  dueDay: string | null;
  revision: number;
  baseline: null | { jobId: string; jobNumber: string | null; completedDay: string; verifiedByName: string; verifiedAt: string };
  proposal: null | { id: string; status: string; scheduledDay: string | null; jobId: string | null; jobNumber: string | null; assigned: boolean | null };
  changeReason: string | null;
};

export type QueueTiles = {
  needsDate: number;
  oldestDue: string | null;
  evidenceChanged: number;
  dueLater: number;
  nextDue: string | null;
  draftCreated: number;
  draftUnassigned: number;
  noBaseline: number;
};

export type DeepCleanQueue = {
  today: string;
  timeZone: string;
  canManage: boolean;
  rows: QueueRow[];
  tiles: QueueTiles;
  noBaseline: Array<{ propertyId: string; propertyName: string }>;
};

const STATE_ORDER: Record<QueueState, number> = {
  evidence_changed: 1,
  needs_date: 0,
  awaiting_check: 2,
  needs_review: 3,
  draft_created: 4,
  due_later: 5,
};

/** Sorted by due date, oldest first; rows that need someone before the rest. */
export function sortQueue(rows: QueueRow[]): QueueRow[] {
  const urgent = (row: QueueRow) => (row.state === "needs_date" || row.state === "evidence_changed" || row.state === "awaiting_check" ? 0 : 1);
  return [...rows].sort((a, b) =>
    urgent(a) - urgent(b)
    || (a.dueDay ?? "9999").localeCompare(b.dueDay ?? "9999")
    || STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || a.propertyName.localeCompare(b.propertyName));
}

export function queueTiles(rows: QueueRow[], noBaseline: number): QueueTiles {
  const needs = rows.filter((row) => row.state === "needs_date");
  const later = rows.filter((row) => row.state === "due_later");
  const drafts = rows.filter((row) => row.state === "draft_created");
  const earliest = (list: QueueRow[]) => list.map((row) => row.dueDay).filter((day): day is string => Boolean(day)).sort()[0] ?? null;
  return {
    needsDate: needs.length,
    oldestDue: earliest(needs),
    evidenceChanged: rows.filter((row) => row.state === "evidence_changed").length,
    dueLater: later.length,
    nextDue: earliest(later),
    draftCreated: drafts.length,
    draftUnassigned: drafts.filter((row) => row.proposal?.assigned === false).length,
    noBaseline,
  };
}

/** Calendar marks for the date panel, from stored bookings and jobs (Sydney days). */
export type DayMarks = { guests: string[]; turnovers: string[] };

export type Candidate = {
  id: string;
  jobNumber: string;
  completedDay: string | null;
  cleaners: string[];
  photos: number;
  videos: number;
  qa: null | { passed: boolean; score: number; notes: string | null };
  /** Why it cannot be chosen; null when it can. */
  blocked: string | null;
};

export type HistoryEntry = { at: string; text: string; actor: string | null };
