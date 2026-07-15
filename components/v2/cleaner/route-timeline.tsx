"use client";

/**
 * Estate route view — today's ordered stops rendered as timeline cards with
 * Google Maps deep links (no map SDK is mounted; navigation links out).
 * Same data source as the live route client: GET /api/cleaner/today-route
 * with optional `?relative=tomorrow` or `?date=YYYY-MM-DD`.
 */
import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bike,
  Car,
  ChevronRight,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Footprints,
  MapPin,
  Navigation,
  RefreshCw,
  RotateCcw,
  Train,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EChip, EInput, ESelect } from "@/components/v2/cleaner/fields";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { haversine } from "@/lib/gps/distance";
import { toast } from "@/hooks/use-toast";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";
export type TravelMode = "DRIVING" | "TRANSIT" | "WALKING" | "BICYCLING";
type RouteMode = "today" | "tomorrow" | "date";

const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  OFFERED: "Offered",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  SUBMITTED: "Submitted",
  QA_REVIEW: "Under review",
  COMPLETED: "Completed",
};

const STATUS_TONE: Record<string, Tone> = {
  OFFERED: "warning",
  EN_ROUTE: "warning",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  PAUSED: "warning",
  SUBMITTED: "warning",
  QA_REVIEW: "aubergine",
  ASSIGNED: "primary",
};

export interface TravelModeMeta {
  value: TravelMode;
  /** Select-menu label. */
  label: string;
  /** Present-tense heading for the "On the way" hero: "Driving to", "Walking to"… */
  headingVerb: string;
  Icon: typeof Car;
  /** Lowercased Google travel mode — matches getEtaMinutes + the maps `travelmode`. */
  etaMode: "driving" | "walking" | "transit" | "bicycling";
  /** Pause reasons that make sense for this mode (first is the default). */
  pauseReasons: string[];
}

export const TRAVEL_MODES: TravelModeMeta[] = [
  { value: "DRIVING", label: "Driving", headingVerb: "Driving to", Icon: Car, etaMode: "driving", pauseReasons: ["Fuel", "Parking", "Traffic"] },
  { value: "TRANSIT", label: "Public transit", headingVerb: "On public transport to", Icon: Train, etaMode: "transit", pauseReasons: ["Waiting for connection", "Service delay"] },
  { value: "WALKING", label: "Walking", headingVerb: "Walking to", Icon: Footprints, etaMode: "walking", pauseReasons: ["Rest break", "Weather"] },
  { value: "BICYCLING", label: "Biking", headingVerb: "Riding to", Icon: Bike, etaMode: "bicycling", pauseReasons: ["Rest break", "Weather"] },
];

export const TRAVEL_MODE_META = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.value, m])
) as Record<TravelMode, TravelModeMeta>;

export interface RouteStop {
  jobId: string;
  jobNumber: number | string | null;
  jobType?: string;
  status: string;
  startTime: string | null;
  dueTime?: string | null;
  /** Estimated on-site duration (hours). Absent from today-route → defaulted. */
  estimatedHours?: number | null;
  /** Planned travel minutes INTO this stop, if the route data carries one. */
  travelMinutes?: number | null;
  enRouteStartedAt?: string | null;
  enRouteEtaMinutes?: number | null;
  arrivedAt?: string | null;
  propertyName: string;
  address: string;
  suburb: string;
  state?: string | null;
  postcode?: string | null;
  latitude: number | null;
  longitude: number | null;
}

/* ── Editable order: persistence + timing guards ──────────────────────────────
   The cleaner can reorder today's stops (up/down). Order is persisted per
   cleaner + day in localStorage; both the timeline and driving mode read it so
   they always show the SAME ordered list. Reorders are guarded by a simple
   day simulation using each job's allowed start (`startTime`), deadline
   (`dueTime`), estimated on-site hours, and rough travel legs. */

const DEFAULT_JOB_HOURS = 2;
const DEFAULT_TRAVEL_MIN = 20;
const AVG_SPEED_KMH = 40; // rough urban average for haversine → minutes
const SOFT_SLACK_MIN = 20; // "tight but feasible" buffer before a deadline

export function orderStorageKey(userId: string, isoDate: string): string {
  return `sneek_route_order_${userId}_${isoDate}`;
}

export function loadStoredOrder(userId: string, isoDate: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(orderStorageKey(userId, isoDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

export function saveStoredOrder(userId: string, isoDate: string, jobIds: string[]): void {
  try {
    window.localStorage.setItem(orderStorageKey(userId, isoDate), JSON.stringify(jobIds));
  } catch {
    /* storage unavailable — order simply isn't persisted */
  }
}

export function clearStoredOrder(userId: string, isoDate: string): void {
  try {
    window.localStorage.removeItem(orderStorageKey(userId, isoDate));
  } catch {
    /* ignore */
  }
}

/** Reorder `stops` to follow a stored jobId order; unknown/new stops keep their
 *  suggested position at the end. Pure — safe for SSR (never touches storage). */
export function applyStoredOrder(stops: RouteStop[], jobIds: string[] | null): RouteStop[] {
  if (!jobIds || jobIds.length === 0) return stops;
  const byId = new Map(stops.map((s) => [s.jobId, s]));
  const ordered: RouteStop[] = [];
  const used = new Set<string>();
  for (const id of jobIds) {
    const stop = byId.get(id);
    if (stop && !used.has(id)) {
      ordered.push(stop);
      used.add(id);
    }
  }
  for (const stop of stops) if (!used.has(stop.jobId)) ordered.push(stop);
  return ordered;
}

/** Minutes-past-midnight from an "HH:mm" clock string, else null. */
export function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function minutesToHHMM(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** Rough travel minutes into `to` from `from`: prefer a route-supplied estimate,
 *  else haversine at an urban average speed, else a flat default. */
function travelMinutes(from: RouteStop | null, to: RouteStop): number {
  if (!from) return 0;
  if (to.travelMinutes != null && Number.isFinite(to.travelMinutes)) return Math.max(0, to.travelMinutes);
  if (from.latitude != null && from.longitude != null && to.latitude != null && to.longitude != null) {
    const km = haversine(from.latitude, from.longitude, to.latitude, to.longitude) / 1000;
    return Math.max(1, Math.round((km / AVG_SPEED_KMH) * 60));
  }
  return DEFAULT_TRAVEL_MIN;
}

export interface StopEval {
  jobId: string;
  arrivalMin: number;
  startMin: number;
  finishMin: number;
  /** Hard: the on-site work would finish after the job's deadline (`dueTime`). */
  hardDeadline: boolean;
  /** Soft: you'd arrive before the allowed start and have to wait to get in. */
  softWait: boolean;
  /** Soft: feasible, but leaves little buffer before the deadline. */
  softDeadline: boolean;
  message: string | null;
}

/**
 * Simulate the day in the given order, from the first stop's start time. Each
 * stop accrues its travel leg then its estimated on-site hours; if you'd arrive
 * before a stop's allowed start (`startTime`, e.g. a late checkout) you WAIT —
 * that's feasible, so it only warns. The real HARD constraint is the deadline:
 * a stop is a hard violation if its work would finish after its `dueTime`.
 *
 * This also captures "a late checkout placed first": anchoring the day at that
 * later start pushes every following stop later, so an earlier-deadline job that
 * now sits behind it finishes past its own `dueTime` → hard violation → blocked.
 */
export function simulateRoute(order: RouteStop[]): StopEval[] {
  const starts = order
    .map((s) => parseHHMM(s.startTime))
    .filter((n): n is number => n != null);
  // Anchor on the first stop's own start time (spec), falling back to the
  // earliest allowed start, then to 08:00.
  const dayStart =
    parseHHMM(order[0]?.startTime) ?? (starts.length > 0 ? Math.min(...starts) : 8 * 60);

  let cursor = dayStart;
  const evals: StopEval[] = [];
  for (let i = 0; i < order.length; i++) {
    const stop = order[i];
    const prev = i > 0 ? order[i - 1] : null;
    const arrival = cursor + travelMinutes(prev, stop);
    const allowedStart = parseHHMM(stop.startTime);
    const due = parseHHMM(stop.dueTime);

    // Arriving before the allowed start means you wait (feasible → soft).
    const softWait = allowedStart != null && arrival < allowedStart;
    const start = allowedStart != null ? Math.max(arrival, allowedStart) : arrival;
    const durationMin = Math.round((stop.estimatedHours ?? DEFAULT_JOB_HOURS) * 60);
    const finish = start + durationMin;

    const hardDeadline = due != null && finish > due;
    const softDeadline = !hardDeadline && due != null && due - finish <= SOFT_SLACK_MIN;

    let message: string | null = null;
    if (hardDeadline) message = `Won't finish by ${stop.dueTime} deadline`;
    else if (softDeadline) message = `Tight — finishes ~${minutesToHHMM(finish)}, before ${stop.dueTime} deadline`;
    else if (softWait) message = `Early — can't start before ${stop.startTime}, you'll wait`;

    evals.push({ jobId: stop.jobId, arrivalMin: arrival, startMin: start, finishMin: finish, hardDeadline, softWait, softDeadline, message });
    cursor = finish;
  }
  return evals;
}

function hardCount(evals: StopEval[]): number {
  return evals.filter((e) => e.hardDeadline).length;
}

/** ISO date (Australia-local wall clock is fine here — matches the route page). */
export function isoDay(offsetDays = 0): string {
  return isoToday(offsetDays);
}

function fullAddress(s: RouteStop) {
  return [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(", ");
}

function isoToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildFullRouteUrl(stops: RouteStop[], travelMode: TravelMode): string | null {
  const addresses = stops.filter((s) => s.address).map(fullAddress);
  if (addresses.length === 0) return null;
  const params = new URLSearchParams({ api: "1", travelmode: travelMode.toLowerCase() });
  params.set("destination", addresses[addresses.length - 1]);
  const wp = addresses.slice(0, -1);
  if (wp.length > 0) params.set("waypoints", wp.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildLegUrl(from: RouteStop | null, to: RouteStop, travelMode: TravelMode): string {
  const params = new URLSearchParams({ api: "1", travelmode: travelMode.toLowerCase() });
  if (from) {
    params.set(
      "origin",
      from.latitude != null && from.longitude != null
        ? `${from.latitude},${from.longitude}`
        : fullAddress(from)
    );
  }
  params.set(
    "destination",
    to.latitude != null && to.longitude != null ? `${to.latitude},${to.longitude}` : fullAddress(to)
  );
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function RouteTimeline({
  initialDate,
  initialStops,
  userId,
  preferredTransport = "DRIVING",
}: {
  initialDate: string;
  initialStops: RouteStop[];
  /** Cleaner id — namespaces the per-day saved order in localStorage. */
  userId?: string;
  /** The cleaner's saved transport mode — seeds the mode selector below. Changing
   *  the selector is in-session only; persisting the change is the settings page. */
  preferredTransport?: TravelMode;
}) {
  const [stops, setStops] = React.useState<RouteStop[]>(initialStops);
  const [routeMode, setRouteMode] = React.useState<RouteMode>("today");
  const [selectedDate, setSelectedDate] = React.useState(initialDate);
  const [travelMode, setTravelMode] = React.useState<TravelMode>(preferredTransport);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const fetchStops = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (routeMode === "tomorrow") params.set("relative", "tomorrow");
      else if (routeMode === "date") params.set("date", selectedDate);
      const url = `/api/cleaner/today-route${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, { cache: "no-store", headers: { "x-progress-toast": "off" } });
      if (!res.ok) throw new Error("Could not load route");
      const data = await res.json();
      const fetched: RouteStop[] = Array.isArray(data.stops) ? data.stops : [];
      // Re-apply the cleaner's saved order for THIS day over the fresh data.
      setStops(applyStoredOrder(fetched, userId ? loadStoredOrder(userId, selectedDate) : null));
    } catch (err: any) {
      setError(err?.message ?? "Could not load route");
    } finally {
      setLoading(false);
    }
  }, [routeMode, selectedDate, userId]);

  // Apply any saved order for the SSR-hydrated initial day (after mount, so the
  // server and first client paint agree — localStorage is client-only).
  React.useEffect(() => {
    if (!userId) return;
    setStops((cur) => applyStoredOrder(cur, loadStoredOrder(userId, selectedDate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch on mode/date change (skip the SSR-hydrated first paint).
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void fetchStops();
  }, [fetchStops]);

  // Per-stop timing evaluation for the current order.
  const evals = React.useMemo(() => simulateRoute(stops), [stops]);
  const evalById = React.useMemo(() => new Map(evals.map((e) => [e.jobId, e])), [evals]);
  const hardTotal = React.useMemo(() => hardCount(evals), [evals]);
  const softTotal = React.useMemo(() => evals.filter((e) => e.softDeadline || e.softWait).length, [evals]);
  const canReorder = Boolean(userId) && stops.length > 1;

  const moveStop = React.useCallback(
    (index: number, dir: "up" | "down") => {
      const target = dir === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= stops.length) return;
      const next = stops.slice();
      [next[index], next[target]] = [next[target], next[index]];

      // GUARD: refuse a move that introduces a new hard timing violation.
      const before = simulateRoute(stops);
      const after = simulateRoute(next);
      if (hardCount(after) > hardCount(before)) {
        const beforeBad = new Set(before.filter((e) => e.hardDeadline).map((e) => e.jobId));
        const culprit = after.find((e) => e.hardDeadline && !beforeBad.has(e.jobId));
        const stop = culprit ? next.find((s) => s.jobId === culprit.jobId) : null;
        toast({
          title: "Can't make that move",
          description:
            culprit?.message && stop
              ? `${stop.propertyName}: ${culprit.message}.`
              : "That order would miss a required start or deadline.",
          variant: "destructive",
        });
        return;
      }

      setStops(next);
      if (userId) saveStoredOrder(userId, selectedDate, next.map((s) => s.jobId));
    },
    [stops, userId, selectedDate]
  );

  const resetOrder = React.useCallback(() => {
    if (userId) clearStoredOrder(userId, selectedDate);
    // Re-fetch the server's suggested order (start-time ascending).
    void fetchStops();
  }, [userId, selectedDate, fetchStops]);

  const fullRouteUrl = React.useMemo(
    () => buildFullRouteUrl(stops, travelMode),
    [stops, travelMode]
  );
  const TravelIcon = TRAVEL_MODES.find((m) => m.value === travelMode)?.Icon ?? Car;

  async function copyRoute() {
    if (!fullRouteUrl) return;
    try {
      await navigator.clipboard.writeText(fullRouteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <ECard>
        <ECardBody className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <EChip
              active={routeMode === "today"}
              onClick={() => {
                setRouteMode("today");
                setSelectedDate(isoToday(0));
              }}
            >
              Today
            </EChip>
            <EChip
              active={routeMode === "tomorrow"}
              onClick={() => {
                setRouteMode("tomorrow");
                setSelectedDate(isoToday(1));
              }}
            >
              Tomorrow
            </EChip>
            <EChip active={routeMode === "date"} onClick={() => setRouteMode("date")}>
              Pick a date
            </EChip>
            {routeMode === "date" ? (
              <EInput
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-auto"
              />
            ) : null}
            <EButton
              variant="ghost"
              size="sm"
              onClick={() => void fetchStops()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </EButton>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-4">
            <div className="w-full max-w-[240px] space-y-1.5">
              <span className="e-eyebrow">TRAVEL MODE</span>
              <ESelect
                value={travelMode}
                onChange={(e) => setTravelMode(e.target.value as TravelMode)}
              >
                {TRAVEL_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </ESelect>
            </div>
            {fullRouteUrl ? (
              <div className="flex gap-2">
                <EButton variant="outline" size="sm" onClick={() => void copyRoute()}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy link"}
                </EButton>
                <a href={fullRouteUrl} target="_blank" rel="noreferrer">
                  <EButton variant="gold" size="sm">
                    <ExternalLink className="h-4 w-4" /> Open all in Maps
                  </EButton>
                </a>
              </div>
            ) : null}
          </div>
        </ECardBody>
      </ECard>

      {error ? (
        <ECard className="border-[hsl(var(--e-warning))]">
          <ECardBody className="pt-6 text-[0.875rem] text-[hsl(var(--e-warning))]">{error}</ECardBody>
        </ECard>
      ) : null}

      {/* Reorder helper + timing summary */}
      {canReorder ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Reorder your stops with the arrows — we check each job's allowed start and deadline.
          </p>
          <EButton variant="ghost" size="sm" onClick={resetOrder} disabled={loading}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset to suggested order
          </EButton>
        </div>
      ) : null}

      {hardTotal > 0 ? (
        <EAlert tone="danger" title={`${hardTotal} timing ${hardTotal === 1 ? "problem" : "problems"} in this order`}>
          One or more stops can't meet their allowed start time or deadline. Use the arrows to move them, or reset to the suggested order.
        </EAlert>
      ) : softTotal > 0 ? (
        <EAlert tone="warning" title={`${softTotal} tight ${softTotal === 1 ? "stop" : "stops"}`}>
          Feasible, but little buffer before a deadline — drive straight through and don't linger.
        </EAlert>
      ) : null}

      {/* Timeline */}
      {stops.length === 0 && !loading ? (
        <EEmptyState
          eyebrow="Clear roads"
          title="No stops scheduled"
          description="No jobs are booked for this date — no driving required."
        />
      ) : (
        <ol className="relative space-y-3">
          {stops.map((s, i) => {
            const prev = i > 0 ? stops[i - 1] : null;
            const isLast = i === stops.length - 1;
            const ev = evalById.get(s.jobId);
            const hard = Boolean(ev && ev.hardDeadline);
            return (
              <li key={s.jobId} className="relative flex gap-3">
                {/* Timeline spine + reorder controls */}
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border font-serif text-[0.9375rem] shadow-[var(--e-elevation-1)] ${
                      hard
                        ? "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] text-[hsl(var(--e-danger))]"
                        : "border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-gold-ink))]"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {canReorder ? (
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        aria-label="Move stop earlier"
                        disabled={i === 0}
                        onClick={() => moveStop(i, "up")}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] transition-colors hover:text-[hsl(var(--e-foreground))] disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move stop later"
                        disabled={isLast}
                        onClick={() => moveStop(i, "down")}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] transition-colors hover:text-[hsl(var(--e-foreground))] disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  {!isLast ? (
                    <span className="w-px flex-1 bg-[hsl(var(--e-border-strong))]" aria-hidden />
                  ) : null}
                </div>

                <ECard
                  className="mb-1 min-w-0 flex-1"
                  variant={s.status === "EN_ROUTE" ? "ceremony" : "default"}
                  style={hard ? { borderColor: "hsl(var(--e-danger))" } : undefined}
                >
                  <ECardBody className="space-y-2.5 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[0.9375rem] font-[550]">{s.propertyName}</p>
                      <EBadge tone={STATUS_TONE[s.status] ?? "neutral"} soft>
                        {STATUS_LABELS[s.status] ?? titleCase(s.status)}
                      </EBadge>
                    </div>

                    {ev && ev.message ? (
                      <p
                        className={`flex items-start gap-1.5 text-[0.75rem] font-[550] ${
                          hard ? "text-[hsl(var(--e-danger))]" : "text-[hsl(var(--e-warning))]"
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{ev.message}</span>
                      </p>
                    ) : null}

                    <p className="flex items-start gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{fullAddress(s) || "Address not set"}</span>
                    </p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        <span className="tabular-nums">
                          {s.startTime && s.dueTime
                            ? `${s.startTime} – ${s.dueTime}`
                            : s.startTime || s.dueTime || "No time set"}
                        </span>
                      </span>
                      {s.jobType ? <span>{titleCase(s.jobType)}</span> : null}
                      {s.enRouteEtaMinutes != null ? (
                        <span className="flex items-center gap-1.5 text-[hsl(var(--e-info))]">
                          <TravelIcon className="h-3.5 w-3.5" />
                          ETA {s.enRouteEtaMinutes} min
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1.5">
                      {fullAddress(s) || (s.latitude != null && s.longitude != null) ? (
                        <a
                          href={buildLegUrl(prev, s, travelMode)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <EButton variant="outline" size="sm">
                            <Navigation className="h-3.5 w-3.5" />
                            {prev ? "Directions from previous stop" : "Directions"}
                          </EButton>
                        </a>
                      ) : null}
                      <EButton asChild variant="ghost" size="sm">
                        <Link href={`/v2/cleaner/jobs/${s.jobId}`}>
                          Open job <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </EButton>
                    </div>

                    {s.status === "OFFERED" ? (
                      <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-2.5">
                        <p className="mb-2 text-[0.75rem] font-[550]">
                          Offered — accept to keep this stop on your route.
                        </p>
                        <JobOfferActions jobId={s.jobId} size="sm" />
                      </div>
                    ) : null}
                  </ECardBody>
                </ECard>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
