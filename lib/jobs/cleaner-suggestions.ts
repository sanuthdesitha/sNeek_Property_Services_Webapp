/**
 * Suggested cleaners for an unassigned job — a PURE ranking over facts the
 * loader (`cleaner-suggestions-load.ts`) reads from existing data only:
 *
 * - availability: the cleaner's saved availability profile
 *   (`lib/accounts/availability.ts`: weekly slots and per-date overrides);
 * - clashes: the cleaner's other active assignments that Sydney day;
 * - history: completed or invoiced jobs at this property the cleaner was on.
 *
 * Every suggestion states its reasons. A clash with a known time, or a job
 * outside the cleaner's saved hours, is returned as a blocked suggestion with
 * the reason, never silently dropped and never offered for assignment.
 *
 * Deliberately not used: travel distance (there is no distance service over
 * the stored coordinates) and QA scores (no batch function exists; the
 * per-job authority lookup would cost one query per job).
 */
export type AvailabilitySlot = { start: string; end: string };

export type SuggestionAvailability = {
  mode: "FIXED" | "FLEXIBLE";
  weekly: Record<string, AvailabilitySlot[]>;
  dateOverrides: Record<string, AvailabilitySlot[]>;
};

export type SuggestionJob = {
  id: string;
  /** yyyy-MM-dd calendar day of the job. */
  dayKey: string;
  startTime: string | null;
  endTime: string | null;
  dueTime: string | null;
  estimatedHours: number | null;
};

export type SuggestionOtherJob = {
  jobId: string;
  propertyName: string;
  startTime: string | null;
  endTime: string | null;
  dueTime: string | null;
  estimatedHours: number | null;
};

export type SuggestionCandidate = {
  id: string;
  name: string;
  /** Null when the cleaner has never saved availability. */
  availability: SuggestionAvailability | null;
  otherJobsThatDay: SuggestionOtherJob[];
  priorCleansHere: number;
};

export type SuggestionBlocker = { kind: "clash" | "unavailable"; reason: string };

export type CleanerSuggestion = {
  cleanerId: string;
  name: string;
  assignable: boolean;
  blocker: SuggestionBlocker | null;
  reasons: string[];
};

type Window = { start: number; end: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function toMinutes(value: string | null | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * A job's time window, only when it is actually known: a start time plus an
 * end, due time or estimated duration. No window is invented from defaults.
 */
export function jobWindow(job: Pick<SuggestionJob, "startTime" | "endTime" | "dueTime" | "estimatedHours">): Window | null {
  const start = toMinutes(job.startTime);
  if (start === null) return null;
  const explicitEnd = toMinutes(job.endTime) ?? toMinutes(job.dueTime);
  const estimated = typeof job.estimatedHours === "number" && Number.isFinite(job.estimatedHours) && job.estimatedHours > 0
    ? start + Math.round(job.estimatedHours * 60)
    : null;
  const end = explicitEnd !== null && explicitEnd > start ? explicitEnd : estimated;
  if (end === null || end <= start) return null;
  return { start, end: Math.min(end, 24 * 60) };
}

function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
}

function slotLabel(slots: AvailabilitySlot[]): string {
  return slots.map((slot) => `${slot.start}–${slot.end}`).join(", ");
}

type AvailabilityVerdict = { blocker: SuggestionBlocker | null; reason: string };

function availabilityVerdict(job: SuggestionJob, window: Window | null, availability: SuggestionAvailability | null): AvailabilityVerdict {
  if (!availability) return { blocker: null, reason: "Availability not set" };
  if (availability.mode === "FLEXIBLE") return { blocker: null, reason: "Flexible hours" };
  const slots = availability.dateOverrides[job.dayKey] ?? availability.weekly[String(weekdayOf(job.dayKey))] ?? [];
  const hasRoster = Object.keys(availability.weekly).length > 0 || Object.keys(availability.dateOverrides).length > 0;
  if (slots.length === 0) {
    if (!hasRoster) return { blocker: null, reason: "Availability not set" };
    const reason = `Not available on ${WEEKDAYS[weekdayOf(job.dayKey)]}s`;
    return { blocker: { kind: "unavailable", reason }, reason };
  }
  if (!window) return { blocker: null, reason: `Available ${slotLabel(slots)} (job time not set)` };
  const fits = slots.some((slot) => {
    const start = toMinutes(slot.start) ?? 0;
    const end = toMinutes(slot.end) ?? 24 * 60;
    return window.start >= start && window.end <= end;
  });
  if (fits) return { blocker: null, reason: `Free ${slotLabel(slots)}` };
  const reason = `Available ${slotLabel(slots)} only`;
  return { blocker: { kind: "unavailable", reason }, reason };
}

/**
 * The roster's verdict for a whole day, with no job time: a blocker when the
 * cleaner has a saved roster and no hours on that day. Used by the calendar to
 * mark days a cleaner is not rostered, with the same wording as suggestions.
 */
export function dayAvailabilityBlocker(dayKey: string, availability: SuggestionAvailability | null): SuggestionBlocker | null {
  const job: SuggestionJob = { id: "", dayKey, startTime: null, endTime: null, dueTime: null, estimatedHours: null };
  return availabilityVerdict(job, null, availability).blocker;
}

type ClashVerdict = { blocker: SuggestionBlocker | null; reasons: string[] };

function clashVerdict(window: Window | null, others: SuggestionOtherJob[]): ClashVerdict {
  if (others.length === 0) return { blocker: null, reasons: ["No other jobs that day"] };
  const reasons: string[] = [];
  let blocker: SuggestionBlocker | null = null;
  for (const other of others) {
    const otherWindow = jobWindow(other);
    if (window && otherWindow && otherWindow.start < window.end && window.start < otherWindow.end) {
      blocker ??= { kind: "clash", reason: `Clashes with ${other.propertyName} until ${formatMinutes(otherWindow.end)}` };
    } else if (!window || !otherWindow) {
      reasons.push(`Also booked at ${other.propertyName} that day (times not set)`);
    }
  }
  if (!blocker && reasons.length === 0) {
    reasons.push(`${others.length} other job${others.length === 1 ? "" : "s"} that day, no overlap`);
  }
  return { blocker, reasons };
}

function historyReason(count: number): string {
  if (count <= 0) return "Has not cleaned here before";
  return `Cleaned here ${count} time${count === 1 ? "" : "s"}`;
}

function evaluate(job: SuggestionJob, candidate: SuggestionCandidate): CleanerSuggestion {
  const window = jobWindow(job);
  const availability = availabilityVerdict(job, window, candidate.availability);
  const clash = clashVerdict(window, candidate.otherJobsThatDay);
  const blocker = clash.blocker ?? availability.blocker;
  const reasons = blocker
    ? [blocker.reason, historyReason(candidate.priorCleansHere)]
    : [availability.reason, historyReason(candidate.priorCleansHere), ...clash.reasons];
  return { cleanerId: candidate.id, name: candidate.name, assignable: blocker === null, blocker, reasons };
}

export type RankOptions = { limit?: number; blockedLimit?: number };

/**
 * Rank candidates: assignable first, ordered by cleans at this property
 * (most first), then fewer other jobs that day, then name. Up to `limit`
 * assignable suggestions, followed by up to `blockedLimit` blocked ones (the
 * most experienced here first) so the office can see why they are not offered.
 */
export function rankCleanerSuggestions(job: SuggestionJob, candidates: SuggestionCandidate[], options: RankOptions = {}): CleanerSuggestion[] {
  const limit = options.limit ?? 5;
  const blockedLimit = options.blockedLimit ?? 3;
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const compare = (a: CleanerSuggestion, b: CleanerSuggestion) => {
    const left = byId.get(a.cleanerId)!;
    const right = byId.get(b.cleanerId)!;
    return right.priorCleansHere - left.priorCleansHere
      || left.otherJobsThatDay.length - right.otherJobsThatDay.length
      || a.name.localeCompare(b.name)
      || a.cleanerId.localeCompare(b.cleanerId);
  };
  const evaluated = candidates.map((candidate) => evaluate(job, candidate));
  const assignable = evaluated.filter((row) => row.assignable).sort(compare).slice(0, limit);
  const blocked = evaluated.filter((row) => !row.assignable).sort(compare).slice(0, blockedLimit);
  return [...assignable, ...blocked];
}
