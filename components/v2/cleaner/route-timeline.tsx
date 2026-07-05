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
  Train,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EChip, EInput, ESelect } from "@/components/v2/cleaner/fields";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";
type TravelMode = "DRIVING" | "TRANSIT" | "WALKING" | "BICYCLING";
type RouteMode = "today" | "tomorrow" | "date";

const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In progress",
  PAUSED: "Paused",
  SUBMITTED: "Submitted",
  QA_REVIEW: "Under review",
  COMPLETED: "Completed",
};

const STATUS_TONE: Record<string, Tone> = {
  EN_ROUTE: "warning",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  PAUSED: "warning",
  SUBMITTED: "warning",
  QA_REVIEW: "aubergine",
  ASSIGNED: "primary",
};

const TRAVEL_MODES: Array<{ value: TravelMode; label: string; Icon: typeof Car }> = [
  { value: "DRIVING", label: "Driving", Icon: Car },
  { value: "TRANSIT", label: "Public transit", Icon: Train },
  { value: "WALKING", label: "Walking", Icon: Footprints },
  { value: "BICYCLING", label: "Biking", Icon: Bike },
];

export interface RouteStop {
  jobId: string;
  jobNumber: number | string | null;
  jobType?: string;
  status: string;
  startTime: string | null;
  dueTime?: string | null;
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
}: {
  initialDate: string;
  initialStops: RouteStop[];
}) {
  const [stops, setStops] = React.useState<RouteStop[]>(initialStops);
  const [routeMode, setRouteMode] = React.useState<RouteMode>("today");
  const [selectedDate, setSelectedDate] = React.useState(initialDate);
  const [travelMode, setTravelMode] = React.useState<TravelMode>("DRIVING");
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
      setStops(Array.isArray(data.stops) ? data.stops : []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load route");
    } finally {
      setLoading(false);
    }
  }, [routeMode, selectedDate]);

  // Refetch on mode/date change (skip the SSR-hydrated first paint).
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void fetchStops();
  }, [fetchStops]);

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
            return (
              <li key={s.jobId} className="relative flex gap-3">
                {/* Timeline spine */}
                <div className="flex flex-col items-center">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-surface))] font-serif text-[0.9375rem] text-[hsl(var(--e-gold-ink))] shadow-[var(--e-elevation-1)]">
                    {i + 1}
                  </span>
                  {!isLast ? (
                    <span className="w-px flex-1 bg-[hsl(var(--e-border-strong))]" aria-hidden />
                  ) : null}
                </div>

                <ECard className="mb-1 min-w-0 flex-1" variant={s.status === "EN_ROUTE" ? "ceremony" : "default"}>
                  <ECardBody className="space-y-2.5 pt-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[0.9375rem] font-[550]">{s.propertyName}</p>
                      <EBadge tone={STATUS_TONE[s.status] ?? "neutral"} soft>
                        {STATUS_LABELS[s.status] ?? titleCase(s.status)}
                      </EBadge>
                    </div>

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
