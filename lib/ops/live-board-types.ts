/**
 * Live ops board: shapes shared by the loader, the API route and the page.
 * Free of server imports.
 */

export type LiveExceptionKind = "late" | "off-site" | "continuation" | "not-started";

export type LiveJobState = "late" | "off-site" | "not-started" | "on-site" | "travelling" | "planned" | "done";

export type LiveCleanerRef = { id: string; name: string; phone: string | null };

export type LiveProgress = {
  /** Percent 0–100. */
  percent: number;
  /** "checklist" = required checklist items answered; "time" = elapsed over allocated (no checklist data). */
  basis: "checklist" | "time";
};

export type LiveJobRow = {
  jobId: string;
  jobNumber: string | null;
  propertyName: string;
  suburb: string | null;
  status: string;
  state: LiveJobState;
  startTime: string | null;
  dueTime: string | null;
  sameDayCheckinTime: string | null;
  cleaners: LiveCleanerRef[];
  /** Minutes behind (late), past start (not started) or away (off site); null when unknown. */
  minutes: number | null;
  /** Projected arrival as HH:mm in the organisation timezone (late / travelling). */
  etaClock: string | null;
  /** Off site: metres from the property at the last ping. */
  distanceMeters: number | null;
  /** On site: minutes since arrival (or clock-in). */
  elapsedMinutes: number | null;
  /** On site: allocated minutes from the job's expected hours; null when not set. */
  allocatedMinutes: number | null;
  progress: LiveProgress | null;
  /** The running time log, for "Review clock" on an off-site row. */
  openTimeLogId: string | null;
  /** Late: projected arrival as an ISO instant (for the delay notice's ETA in minutes). */
  etaAt?: string | null;
  /** Late: the client delay notice already requested today, if any (who and when). */
  delayNotice?: { at: string; byName: string } | null;
  /** Every running clock on the job (the cleaner each belongs to), for "Pause clock". */
  runningClocks?: Array<{ timeLogId: string; userId: string; name: string; startedAt: string }>;
  /** Field status (moved from the old live map page). */
  field: {
    address: string | null;
    safety: "pending" | "confirmed" | null;
    checkInDistanceMeters: number | null;
    gpsCheckInAt: string | null;
  };
};

export type LiveContinuationRow = {
  id: string;
  jobId: string;
  propertyName: string;
  cleanerName: string;
  reason: string;
  remainingHours: number | null;
  requestedAt: string;
};

export type LiveDriverRow = {
  routeId: string;
  userId: string;
  name: string;
  phone: string | null;
  stopsDone: number;
  stopsTotal: number;
  lat: number | null;
  lng: number | null;
  lastPingAt: string | null;
};

export type LiveCleanerNext = { userId: string; nextJob: { jobId: string; propertyName: string; startTime: string | null } | null; phone: string | null };

export type LiveAttentionCounts = { label: string; count: number }[];

export type LiveBoardPayload = {
  todayKey: string;
  timeZone: string;
  jobs: LiveJobRow[];
  continuations: LiveContinuationRow[];
  drivers: LiveDriverRow[];
  cleaners: LiveCleanerNext[];
  counts: { exceptions: number; onSite: number; travelling: number; notStarted: number; cleanersOnShift: number; driversOnShift: number };
  generatedAt: string;
};
