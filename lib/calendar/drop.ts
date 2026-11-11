/**
 * What a drop on the calendar asks for. Pure: the page turns the result into
 * a move check; the server decides whether the move is allowed.
 */
export type DropLane = "unassigned" | "cleaner" | "property";
export type DropPoint = { lane: DropLane; rowId: string | null; day: string };

export type DropOutcome =
  | { kind: "none" }
  | { kind: "ignored"; reason: string }
  | { kind: "move"; toDate: string; fromCleanerId: string | null; toCleanerId: string | null };

export function resolveDrop(source: DropPoint, target: DropPoint): DropOutcome {
  if (source.lane === "property" || target.lane === "property") {
    if (source.rowId !== target.rowId) {
      return { kind: "ignored", reason: "A job stays at its property. Drop it on another day in the same row." };
    }
    return target.day === source.day ? { kind: "none" } : { kind: "move", toDate: target.day, fromCleanerId: null, toCleanerId: null };
  }
  if (target.lane === "unassigned" && source.lane === "cleaner") {
    return { kind: "ignored", reason: "To take a cleaner off a job, use Assign cleaners in the job's menu." };
  }
  const changesCleaner = target.lane === "cleaner" && target.rowId !== null && target.rowId !== source.rowId;
  if (!changesCleaner && target.day === source.day) return { kind: "none" };
  return {
    kind: "move",
    toDate: target.day,
    fromCleanerId: changesCleaner && source.lane === "cleaner" ? source.rowId : null,
    toCleanerId: changesCleaner ? target.rowId : null,
  };
}
