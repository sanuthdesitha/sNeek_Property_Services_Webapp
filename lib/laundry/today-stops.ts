/**
 * The laundry portal "Today" route list (board "Laundry partner portal", 1
 * Today): stops in route order with planned times, done / now / next, and one
 * line of facts per stop from recorded data only. PURE and PLAIN.
 */
import type { LaundryOfficeRequest } from "./office-request-types";

export type TodayStopKind = "PICKUP" | "DROP";
export type TodayStopState = "done" | "now" | "next";

export type TodayStopFacts = {
  taskId: string;
  kind: TodayStopKind;
  propertyName: string;
  address: string | null;
  /** Planned clock time for this leg (HH:mm), when the office planned one. */
  plannedTime: string | null;
  /** When the stop was recorded done (ISO), from the route stop or the run. */
  completedAt: string | null;
  status: string;
  /** Latest bag count recorded on any handoff. */
  bagCount: number | null;
  /** The cleaner's latest readiness: true ready, false not ready, null not confirmed. */
  readiness: boolean | null;
  bagLocation: string | null;
  hasDropPhoto: boolean;
  receiptAud: number | null;
  /** The office asked for a photo / time on this run and it is still open. */
  officeAsked: string | null;
  nextGuestDay: string | null;
};

export type TodayStop = TodayStopFacts & { number: number; state: TodayStopState; line: string; tone: "ok" | "warn" | "neutral" };

function bags(count: number | null): string | null {
  return count ? `${count} bag${count === 1 ? "" : "s"}` : null;
}

function isDone(stop: TodayStopFacts): boolean {
  if (stop.completedAt) return true;
  return stop.kind === "PICKUP" ? ["PICKED_UP", "DROPPED"].includes(stop.status) : stop.status === "DROPPED";
}

function factsLine(stop: TodayStopFacts, done: boolean, clock: (iso: string) => string): { line: string; tone: TodayStop["tone"] } {
  if (done) {
    if (stop.kind === "DROP" && !stop.hasDropPhoto) return { line: stop.officeAsked ? "No drop photo · office asked for one" : "No drop photo", tone: "warn" };
    const parts = [bags(stop.bagCount), stop.completedAt ? clock(stop.completedAt) : null, stop.kind === "DROP" ? stop.bagLocation : null, stop.kind === "DROP" && stop.receiptAud != null ? `receipt $${stop.receiptAud.toFixed(2)}` : null, stop.hasDropPhoto && stop.kind === "DROP" ? "photo" : null];
    return { line: parts.filter(Boolean).join(" · ") || "Done", tone: "neutral" };
  }
  if (stop.kind === "PICKUP") {
    if (stop.readiness === true) return { line: [`Ready${stop.bagCount ? ` · ${bags(stop.bagCount)}` : ""}`, stop.bagLocation].filter(Boolean).join(" · "), tone: "ok" };
    if (stop.readiness === false) return { line: "Not ready yet (cleaner said)", tone: "warn" };
    return { line: "Cleaner has not confirmed bags", tone: "warn" };
  }
  return { line: [bags(stop.bagCount), stop.nextGuestDay ? `next guest ${stop.nextGuestDay}` : null].filter(Boolean).join(" · ") || "Drop-off", tone: "neutral" };
}

/** Number the stops in route order and mark done, the current one and the rest. */
export function buildTodayStops(facts: readonly TodayStopFacts[], clock: (iso: string) => string): TodayStop[] {
  let nowAssigned = false;
  return facts.map((stop, index) => {
    const done = isDone(stop);
    const state: TodayStopState = done ? "done" : nowAssigned ? "next" : "now";
    if (!done) nowAssigned = true;
    const { line, tone } = factsLine(stop, done, clock);
    return { ...stop, number: index + 1, state, line, tone };
  });
}

/** Planned time first (unplanned last), then pickups before drops, then name. For a day without a route. */
export function orderUnroutedStops<T extends { plannedTime: string | null; kind: TodayStopKind; propertyName: string }>(stops: readonly T[]): T[] {
  return [...stops].sort((a, b) => (a.plannedTime ?? "99:99").localeCompare(b.plannedTime ?? "99:99") || (a.kind === b.kind ? 0 : a.kind === "PICKUP" ? -1 : 1) || a.propertyName.localeCompare(b.propertyName));
}

/** Which open office request is about this run (shown on the stop line). */
export function officeAskFor(taskId: string, requests: readonly LaundryOfficeRequest[] | null): string | null {
  const open = requests?.find((request) => request.taskId === taskId && request.state === "open");
  return open ? open.badge : null;
}

/** Google Maps directions through the stops still to do (null without addresses). */
export function remainingAddresses(stops: readonly TodayStop[]): string[] {
  return stops.filter((stop) => stop.state !== "done").map((stop) => stop.address ?? "").filter(Boolean);
}
