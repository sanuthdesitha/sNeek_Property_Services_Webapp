/**
 * Live ops exception rules. Pure; unit-tested in tests/lib/live-board-rules.test.ts.
 *
 * Times on a job (startTime, dueTime) are HH:mm wall-clock in the organisation
 * timezone on the job's calendar day (scheduledDate is a UTC-midnight key).
 *
 * - Late: on the way (EN_ROUTE), not arrived, and the projected arrival (the
 *   last ETA the app recorded, else now) is more than LATE_GRACE_MINUTES past
 *   the start time. The start time is when the cleaner is due on site.
 * - Off site with the clock running: an open time log while the live status
 *   (lib/ops/live-status: fresh ping outside the geofence, or a recorded
 *   geofence departure) says the cleaner is not at the property.
 * - Not started: assigned (or still unassigned) for today, not on the way, not
 *   clocked in and not arrived, more than NOT_STARTED_GRACE_MINUTES after the
 *   start time.
 */
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type { LiveJobState } from "./live-board-types";

export const LATE_GRACE_MINUTES = 10;
export const NOT_STARTED_GRACE_MINUTES = 15;

const NOT_STARTED_STATUSES = new Set(["UNASSIGNED", "OFFERED", "ASSIGNED"]);
const ON_SITE_STATUSES = new Set(["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"]);
const DONE_STATUSES = new Set(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]);
const AWAY_LIVE_STATUSES = new Set(["OFF_SITE", "LEFT_SITE"]);

export type LiveJobFacts = {
  status: string;
  dateKey: string;
  startTime: string | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  enRouteEtaMinutes: number | null;
  enRouteEtaUpdatedAt: Date | null;
  hasOpenTimer: boolean;
  /** Derived live status of the job's cleaner (lib/ops/live-status), null when unknown. */
  liveStatus: string | null;
};

export type LiveClassification = { state: LiveJobState; minutes: number | null; projectedArrival: Date | null };

/** The instant a wall-clock HH:mm happens on a calendar day in a timezone; null if malformed. */
export function wallClockInstant(dateKey: string, hhmm: string | null, timeZone: string): Date | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return null;
  const [h, m] = hhmm.trim().split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return fromZonedTime(`${dateKey}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`, timeZone);
}

export function clockLabel(at: Date, timeZone: string): string {
  return formatInTimeZone(at, timeZone, "HH:mm");
}

function minutesBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60_000);
}

/** Projected arrival: the recorded ETA from when it was recorded, never earlier than now. */
export function projectedArrival(facts: Pick<LiveJobFacts, "enRouteEtaMinutes" | "enRouteEtaUpdatedAt">, now: Date): Date {
  if (facts.enRouteEtaMinutes == null) return now;
  const from = facts.enRouteEtaUpdatedAt ?? now;
  const eta = new Date(from.getTime() + facts.enRouteEtaMinutes * 60_000);
  return eta.getTime() < now.getTime() ? now : eta;
}

export function classifyLiveJob(facts: LiveJobFacts, now: Date, timeZone: string): LiveClassification {
  if (DONE_STATUSES.has(facts.status)) return { state: "done", minutes: null, projectedArrival: null };
  const start = wallClockInstant(facts.dateKey, facts.startTime, timeZone);

  if (facts.hasOpenTimer && facts.liveStatus && AWAY_LIVE_STATUSES.has(facts.liveStatus)) {
    const minutes = facts.departedAt ? Math.max(0, minutesBetween(now, facts.departedAt)) : null;
    return { state: "off-site", minutes, projectedArrival: null };
  }

  if (facts.status === "EN_ROUTE" && !facts.arrivedAt) {
    const arrival = projectedArrival(facts, now);
    if (start) {
      const lateBy = minutesBetween(arrival, start);
      if (lateBy > LATE_GRACE_MINUTES) return { state: "late", minutes: lateBy, projectedArrival: arrival };
    }
    return { state: "travelling", minutes: null, projectedArrival: facts.enRouteEtaMinutes != null ? arrival : null };
  }

  if (facts.hasOpenTimer || ON_SITE_STATUSES.has(facts.status) || (facts.arrivedAt && facts.status === "EN_ROUTE")) {
    return { state: "on-site", minutes: null, projectedArrival: null };
  }

  if (NOT_STARTED_STATUSES.has(facts.status) && !facts.arrivedAt) {
    if (start) {
      const past = minutesBetween(now, start);
      if (past > NOT_STARTED_GRACE_MINUTES) return { state: "not-started", minutes: past, projectedArrival: null };
    }
    return { state: "planned", minutes: null, projectedArrival: null };
  }
  return { state: "planned", minutes: null, projectedArrival: null };
}

export function isException(state: LiveJobState): boolean {
  return state === "late" || state === "off-site" || state === "not-started";
}

/** "Not started" chip: every job of today nobody has started, past its start or not. */
export function isNotStarted(state: LiveJobState): boolean {
  return state === "not-started" || state === "planned";
}
