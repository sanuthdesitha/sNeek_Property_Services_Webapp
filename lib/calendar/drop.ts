/**
 * What a drop on the calendar asks for. Pure: the page turns the result into
 * a move check; the server decides whether the move is allowed.
 *
 * A drop on the Day view's hour track also carries the minute under the
 * pointer; the page turns it into a proposed start (`time-drop.ts`) and passes
 * it here as `timing`. A time is only proposed within the same day.
 */
export type DropLane = "unassigned" | "cleaner" | "property";
export type DropPoint = {
  lane: DropLane;
  rowId: string | null;
  day: string;
  /** Minute of the day under the pointer on an hour track (Day view), else absent. */
  minute?: number | null;
};

/** The job's current start and the start a time-track drop proposes (HH:mm). */
export type DropTiming = { currentStart: string | null; proposedStart: string | null };

export type DropOutcome =
  | { kind: "none" }
  | { kind: "ignored"; reason: string }
  | { kind: "move"; toDate: string; fromCleanerId: string | null; toCleanerId: string | null; toStartTime?: string };

function proposedTime(source: DropPoint, target: DropPoint, timing?: DropTiming): string | null {
  if (!timing?.proposedStart || target.day !== source.day) return null;
  return timing.proposedStart === timing.currentStart ? null : timing.proposedStart;
}

export function resolveDrop(source: DropPoint, target: DropPoint, timing?: DropTiming): DropOutcome {
  const toStartTime = proposedTime(source, target, timing);
  if (source.lane === "property" || target.lane === "property") {
    if (source.rowId !== target.rowId) {
      return { kind: "ignored", reason: "A job stays at its property. Drop it on another day in the same row." };
    }
    if (target.day === source.day && !toStartTime) return { kind: "none" };
    return { kind: "move", toDate: target.day, fromCleanerId: null, toCleanerId: null, ...(toStartTime ? { toStartTime } : {}) };
  }
  if (target.lane === "unassigned" && source.lane === "cleaner") {
    return { kind: "ignored", reason: "To take a cleaner off a job, use Assign cleaners in the job's menu." };
  }
  const changesCleaner = target.lane === "cleaner" && target.rowId !== null && target.rowId !== source.rowId;
  if (!changesCleaner && target.day === source.day && !toStartTime) return { kind: "none" };
  return {
    kind: "move",
    toDate: target.day,
    fromCleanerId: changesCleaner && source.lane === "cleaner" ? source.rowId : null,
    toCleanerId: changesCleaner ? target.rowId : null,
    ...(toStartTime ? { toStartTime } : {}),
  };
}
