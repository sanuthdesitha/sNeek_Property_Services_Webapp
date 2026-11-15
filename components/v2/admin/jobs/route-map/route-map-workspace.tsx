"use client";

/**
 * Route map workspace (board "Route map", 2026-11-17): the day's routes beside
 * a map. One read per date (`GET /api/admin/jobs/route-map`); changing the
 * date aborts the old read and a late answer is never shown for another day.
 * Loading, failed, empty and ready are separate states; a failed refresh keeps
 * the last good day with a stale notice.
 *
 * The list and the map share one selection. "Assign…", "Choose…" and
 * "Change cleaner…" open the shared assign dialog for the job (same request,
 * notifications and history as the job page). Nothing is dragged: the order is
 * worked out, not stored.
 *
 * Below 640px: a List / Map switch that keeps the selected stop; a pin opens
 * its stop in a bottom sheet; the docked action is the next job to assign.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, ECard, EPageHeader } from "@/components/v2/ui/primitives";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { AssignDialog, type AssignTarget } from "@/components/v2/admin/jobs/assign-dialog";
import { isRouteMapDay, type RouteMapDay, type RouteMapRoute, type RouteMapStop, type RouteMapUnassignedJob } from "@/lib/ops/route-map-types";
import { RouteMapCanvas } from "./route-map-canvas";
import { MapsLinks, RouteCard, RouteLetter, UnassignedCard, suggestedCleaner } from "./route-list";
import { RouteLineSample } from "./route-lines";
import {
  buildMapLines, buildMapPins, jobTypeWords, routeDayFacts, routeKeyWords, routeVisible, statusWords, stopKey, timeRange,
  travelWords, unassignedKey, unassignedVisible, type RouteFilter,
} from "./route-map-model";

type Load =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; day: RouteMapDay; stale: boolean };

type Selection =
  | { kind: "stop"; route: RouteMapRoute; stop: RouteMapStop; index: number }
  | { kind: "unassigned"; job: RouteMapUnassignedJob };

const MUTED = "text-[hsl(var(--e-text-secondary))]";
const MAP_HEIGHT = "h-[60vh] min-h-[320px] lg:h-[600px]";
/** Routes shown expanded at first (plus every flagged route). */
const OPEN_ROUTES = 2;

/** A calendar day ("2026-11-15") as words, never shifted by the viewer's timezone. */
function calendarDay(date: string): Date {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  return new Date(year, month - 1, dayOfMonth);
}

function longDayLabel(date: string): string {
  return format(calendarDay(date), "EEE d MMM yyyy");
}

function shortDayLabel(date: string): string {
  return format(calendarDay(date), "EEE d MMM");
}

function shiftDate(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A small figure tile. On a phone it shows `phone` (value and words) instead, as the board's three compact tiles. */
function FactTile({ label, value, sub, isNew = false, phone, className }: { label: string; value: React.ReactNode; sub: React.ReactNode; isNew?: boolean; phone?: { value: React.ReactNode; words: string }; className?: string }) {
  return (
    <ECard className={cn("min-w-0 px-3.5 py-3 max-sm:px-2.5 max-sm:py-2", className)}>
      <div className={phone ? "max-sm:hidden" : undefined}>
        <p className="text-[0.6875rem] font-[550] text-[hsl(var(--e-text-secondary))]">{label}{isNew ? <span className="ml-1.5 rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-info-soft))] px-1.5 text-[0.625rem] text-[hsl(var(--e-info))]">new</span> : null}</p>
        <p className="mt-0.5 text-[1.0625rem] font-[650] leading-tight [overflow-wrap:anywhere]">{value}</p>
        <p className={cn("mt-0.5 text-[0.6875rem]", MUTED)}>{sub}</p>
      </div>
      {phone ? (
        <div className="sm:hidden">
          <p className="text-[1.0625rem] font-[650] leading-tight">{phone.value}</p>
          <p className={cn("text-[0.6875rem] leading-tight", MUTED)}>{phone.words}</p>
        </div>
      ) : null}
    </ECard>
  );
}

function shortTravel(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
}

function DateNav({ date, today, tomorrow, disabled }: { date: string; today: string; tomorrow: string; disabled: boolean }) {
  const router = useRouter();
  const go = (next: string) => router.push(`/v2/admin/jobs/route-map?date=${next}`, { scroll: false });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <EButton size="icon" variant="outline" aria-label="Previous day" onClick={() => go(shiftDate(date, -1))} className="h-8 w-8"><ChevronLeft className="h-4 w-4" aria-hidden /></EButton>
      <label className="sr-only" htmlFor="route-map-date">Date</label>
      <input
        id="route-map-date"
        type="date"
        value={date}
        onChange={(event) => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) go(event.target.value); }}
        disabled={disabled}
        className="h-8 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] text-[hsl(var(--e-foreground))] [color-scheme:inherit] max-sm:h-11 max-sm:text-[1rem]"
      />
      <EButton size="icon" variant="outline" aria-label="Next day" onClick={() => go(shiftDate(date, 1))} className="h-8 w-8"><ChevronRight className="h-4 w-4" aria-hidden /></EButton>
      <EButton asChild size="sm" variant={date === today ? "primary" : "outline"}><Link href={`/v2/admin/jobs/route-map?date=${today}`} scroll={false} aria-current={date === today ? "date" : undefined}>Today</Link></EButton>
      <EButton asChild size="sm" variant={date === tomorrow ? "primary" : "outline"}><Link href={`/v2/admin/jobs/route-map?date=${tomorrow}`} scroll={false} aria-current={date === tomorrow ? "date" : undefined}>Tomorrow</Link></EButton>
      <EButton asChild size="sm" variant="outline"><Link href="/v2/admin/ops"><MapPinned className="h-4 w-4" aria-hidden />Live ops</Link></EButton>
    </div>
  );
}

/** What the selected stop offers, on the map card and in the phone sheet. */
function SelectionActions({ selection, onAssign, onChange, large }: { selection: Selection; onAssign: (job: RouteMapUnassignedJob, suggestedId: string | null) => void; onChange: (route: RouteMapRoute, stop: RouteMapStop) => void; large: boolean }) {
  const size = large ? "md" : "sm";
  if (selection.kind === "unassigned") {
    const best = suggestedCleaner(selection.job.suggestion);
    return (
      <div className={cn("flex gap-1.5", large ? "flex-col" : "flex-wrap")}>
        {best ? <EButton size={size} onClick={() => onAssign(selection.job, best.cleanerId)}>Assign {best.cleanerName.split(/\s+/)[0]}…</EButton> : null}
        <EButton size={size} variant="outline" onClick={() => onAssign(selection.job, null)}>{large ? "Choose another cleaner…" : "Choose…"}</EButton>
        <EButton asChild size={size} variant="ghost"><Link href={`/v2/admin/jobs/${selection.job.jobId}`}>Open job</Link></EButton>
      </div>
    );
  }
  return (
    <div className={cn("flex gap-1.5", large ? "flex-col" : "flex-wrap")}>
      <EButton asChild size={size} variant={large ? "primary" : "outline"}><Link href={`/v2/admin/jobs/${selection.stop.jobId}`}>Open job</Link></EButton>
      <EButton size={size} variant="outline" onClick={() => onChange(selection.route, selection.stop)}>Change cleaner…</EButton>
      {selection.stop.mapsHref ? (
        <EButton asChild size={size} variant="ghost"><a href={selection.stop.mapsHref} target="_blank" rel="noreferrer" aria-label={`Maps: ${selection.stop.propertyName} (opens Google Maps)`}>Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a></EButton>
      ) : null}
    </div>
  );
}

function selectionTitle(selection: Selection): string {
  return selection.kind === "unassigned" ? selection.job.propertyName : `${selection.route.letter}${selection.index + 1} · ${selection.stop.propertyName}`;
}

function selectionLine(selection: Selection): string {
  if (selection.kind === "unassigned") {
    return `${selection.job.address} · ${timeRange(selection.job.startTime, selection.job.dueTime)} · nobody on it`;
  }
  return `${selection.route.cleanerName} · ${timeRange(selection.stop.startTime, selection.stop.dueTime)} · ${statusWords(selection.stop.status)} · stop ${selection.index + 1} of ${selection.route.stops.length}`;
}

function suggestionSentence(job: RouteMapUnassignedJob): string | null {
  const best = suggestedCleaner(job.suggestion);
  if (!best) return null;
  const qa = best.qaScore === null ? "no QA reviews yet" : `QA ${best.qaScore.toFixed(1)}`;
  return `Suggested ${best.cleanerName}: ${qa}, suburb history ${best.suburbHistory}, load ${best.load}/${best.maxDailyJobs}, availability fits.`;
}

function findSelection(day: RouteMapDay | null, key: string | null): Selection | null {
  if (!day || !key) return null;
  if (key.startsWith("u:")) {
    const job = day.unassigned.find((item) => unassignedKey(item.jobId) === key);
    return job ? { kind: "unassigned", job } : null;
  }
  for (const route of day.routes) {
    const index = route.stops.findIndex((stop) => stopKey(route.cleanerId, stop.jobId) === key);
    if (index >= 0) return { kind: "stop", route, stop: route.stops[index], index };
  }
  return null;
}

function MapKey({ day }: { day: RouteMapDay }) {
  return (
    <div className="space-y-2 border-t border-[hsl(var(--e-border))] px-4 py-3 text-[0.75rem]" role="group" aria-label="Map key">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {day.routes.map((route) => (
          <span key={route.cleanerId} className="inline-flex items-center gap-1.5">
            {route.stops.length > 1 ? <RouteLineSample lookIndex={route.lookIndex} /> : null}
            <RouteLetter route={route} size="sm" />
            {routeKeyWords(route)}
          </span>
        ))}
        {day.unassigned.length ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="relative inline-flex h-5 w-5 items-center justify-center"><span className="absolute inset-[3px] rotate-45 rounded-[3px] border-2 border-[hsl(var(--e-foreground))]" /><span className="relative text-[0.625rem] font-bold">?</span></span>
            nobody on it
          </span>
        ) : null}
      </div>
      {day.routes.filter((route) => route.hiddenStopCount > 0).map((route) => (
        <p key={route.cleanerId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-band-attention-line))] bg-[hsl(var(--e-band-attention-bg))] px-2.5 py-1.5 text-[hsl(var(--e-band-attention-fg))]">
          {route.cleanerName}: {route.hiddenStopCount} more stop{route.hiddenStopCount === 1 ? " is" : "s are"} not on the map — the rule &lsquo;Routes: stops shown&rsquo; is set to {route.stopLimit}. <Link href="/v2/admin/settings/scheduling-rules" className="font-[600] underline">Settings › Scheduling rules</Link>
        </p>
      ))}
      <p className={MUTED}>
        Pins carry the cleaner&apos;s letter and stop number, and each route has its own line pattern, so colour is never the only way to tell routes apart. Picking a pin selects the same stop in the list, and the reverse. A dashed ring means the property has no saved map position and sits at its suburb centre.
      </p>
    </div>
  );
}

export function RouteMapWorkspace({ date, today, tomorrow, mapConfigured }: { date: string; today: string; tomorrow: string; mapConfigured: boolean }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [filter, setFilter] = useState<RouteFilter>({ search: "", show: "all" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [assign, setAssign] = useState<AssignTarget | null>(null);
  const [phoneView, setPhoneView] = useState<"list" | "map">("list");
  const [sheetOpen, setSheetOpen] = useState(false);
  const phone = useIsPhone();
  const dateRef = useRef(date);
  dateRef.current = date;

  // A new date: drop the old day (never show it as this one), filters and selection reset.
  useEffect(() => {
    setLoad({ status: "loading" });
    setSelectedKey(null);
    setExpanded({});
    setSheetOpen(false);
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    const requested = date;
    fetch(`/api/admin/jobs/route-map?date=${encodeURIComponent(requested)}`, { cache: "no-store", signal: controller.signal, headers: { "x-progress-toast": "off" } })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted || dateRef.current !== requested) return;
        if (!response.ok || !isRouteMapDay(body) || body.date !== requested) {
          const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "";
          setLoad((current) => (current.status === "ready" && current.day.date === requested ? { ...current, stale: true } : { status: "failed", message }));
          return;
        }
        setLoad({ status: "ready", day: body, stale: false });
      })
      .catch(() => {
        if (controller.signal.aborted || dateRef.current !== requested) return;
        setLoad((current) => (current.status === "ready" && current.day.date === requested ? { ...current, stale: true } : { status: "failed", message: "" }));
      });
    return () => controller.abort();
  }, [date, reloadToken]);

  const day = load.status === "ready" ? load.day : null;
  const facts = day ? routeDayFacts(day) : null;
  const visibleRoutes = useMemo(() => (day ? day.routes.filter((route) => routeVisible(route, filter)) : []), [day, filter]);
  const visibleUnassigned = useMemo(() => (day ? day.unassigned.filter((job) => unassignedVisible(job, filter)) : []), [day, filter]);
  const pins = useMemo(() => (day ? buildMapPins(day, filter) : []), [day, filter]);
  const lines = useMemo(() => (day ? buildMapLines(day, filter) : []), [day, filter]);
  const selection = findSelection(day, selectedKey);

  const isExpanded = useCallback((route: RouteMapRoute, index: number) => {
    const chosen = expanded[route.cleanerId];
    if (chosen !== undefined) return chosen;
    const holdsSelection = selectedKey?.startsWith(`s:${route.cleanerId}:`) ?? false;
    return index < OPEN_ROUTES || route.timeIssues.some((issue) => issue.kind !== "no_start_time") || route.hiddenStopCount > 0 || holdsSelection;
  }, [expanded, selectedKey]);

  const select = useCallback((key: string) => {
    setSelectedKey(key);
    // On a phone the stop's actions (Open job, Maps, Change cleaner…) open in a sheet, from the list or the map.
    if (phone) setSheetOpen(true);
    // Keep the chosen stop in view in the list (the map stays put beside it).
    if (!phone || phoneView === "list") {
      window.requestAnimationFrame(() => document.getElementById(key)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }, [phone, phoneView]);

  // Back to the list on a phone: scroll to the stop chosen on the map.
  useEffect(() => {
    if (!phone || phoneView !== "list" || !selectedKey) return;
    window.requestAnimationFrame(() => document.getElementById(selectedKey)?.scrollIntoView({ block: "center" }));
    // Only when the view switches back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneView]);

  const openAssign = useCallback((job: RouteMapUnassignedJob, suggestedId: string | null) => {
    setSheetOpen(false);
    setAssign({
      kind: "job",
      jobId: job.jobId,
      context: [job.jobNumber, job.propertyName, `${shortDayLabel(date)}${job.startTime ? ` ${job.startTime}` : ""}`].filter(Boolean).join(" · "),
      phoneTitle: `Assign · ${job.propertyName}, ${shortDayLabel(date)}`,
      initialAssignedIds: [],
      initialPrimaryId: null,
      suggestedIds: suggestedId ? [suggestedId] : [],
    });
  }, [date]);

  const openChange = useCallback((route: RouteMapRoute, stop: RouteMapStop) => {
    setSheetOpen(false);
    setAssign({
      kind: "job",
      jobId: stop.jobId,
      context: [stop.propertyName, `${shortDayLabel(date)}${stop.startTime ? ` ${stop.startTime}` : ""}`, `now ${route.cleanerName}`].join(" · "),
      phoneTitle: `Change cleaner · ${stop.propertyName}, ${shortDayLabel(date)}`,
      initialAssignedIds: stop.assigneeIds,
      initialPrimaryId: stop.primaryAssigneeId,
    });
  }, [date]);

  const summary = facts
    ? [longDayLabel(date), plural(facts.routes, "cleaner route"), plural(facts.stops, "assigned stop"), `${plural(facts.nobody, "job")} with nobody on ${facts.nobody === 1 ? "it" : "them"}`].join(" · ")
    : load.status === "failed" ? `${longDayLabel(date)} · routes not loaded` : `${longDayLabel(date)} · loading routes…`;
  const phoneSummary = facts ? [shortDayLabel(date), plural(facts.routes, "route"), plural(facts.stops, "stop")].join(" · ") : shortDayLabel(date);

  const nextToAssign = day?.unassigned[0] ?? null;
  const nextBest = nextToAssign ? suggestedCleaner(nextToAssign.suggestion) : null;

  const overlayCard = selection ? (
    <ECard className="space-y-2 p-3 shadow-[var(--e-elevation-2,0_6px_20px_hsl(160_30%_10%/0.18))]">
      <div>
        <p className="text-[0.8125rem] font-[650]">{selectionTitle(selection)}</p>
        <p className={cn("text-[0.75rem]", MUTED)}>{selectionLine(selection)}</p>
      </div>
      <SelectionActions selection={selection} onAssign={openAssign} onChange={openChange} large={false} />
    </ECard>
  ) : null;

  const list = (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 max-sm:basis-full">
          <span className="sr-only">Find a cleaner, property or suburb</span>
          <input
            type="search"
            value={filter.search}
            onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value }))}
            placeholder="Find a cleaner, property or suburb"
            className="h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] max-sm:h-11 max-sm:text-[1rem]"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[0.8125rem]">
          <span className={MUTED}>Show on map</span>
          <select
            value={filter.show}
            onChange={(event) => setFilter((current) => ({ ...current, show: event.target.value }))}
            className="h-9 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem] [color-scheme:inherit] max-sm:h-11 max-sm:text-[1rem]"
          >
            <option value="all">All</option>
            <option value="nobody">Nobody on it</option>
            {day?.routes.map((route) => <option key={route.cleanerId} value={route.cleanerId}>{route.cleanerName}</option>)}
          </select>
        </label>
      </div>
      {load.status === "loading" ? (
        <div role="status" aria-label="Loading routes" className="space-y-3">
          {[0, 1, 2].map((row) => <div key={row} className="h-28 animate-pulse rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-surface-raised))]" />)}
        </div>
      ) : null}
      {load.status === "failed" ? (
        <ECard role="alert" className="space-y-2 p-4">
          <p className="text-[0.875rem] font-[600]">Routes for {longDayLabel(date)} could not be loaded.</p>
          <p className={cn("text-[0.8125rem]", MUTED)}>Nothing is shown rather than an empty day.{load.message ? ` ${load.message}` : ""}</p>
          <EButton size="sm" variant="outline" onClick={() => setReloadToken((value) => value + 1)}>Try again</EButton>
        </ECard>
      ) : null}
      {day && load.status === "ready" && load.stale ? (
        <p role="status" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-band-attention-line))] bg-[hsl(var(--e-band-attention-bg))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-band-attention-fg))]">
          These routes could not be refreshed; they are as last loaded. <button type="button" className="underline" onClick={() => setReloadToken((value) => value + 1)}>Try again</button>
        </p>
      ) : null}
      {day ? (
        <>
          {visibleUnassigned.length > 0 ? (
            <UnassignedCard jobs={visibleUnassigned} limit={day.suggestionLimit} selectedKey={selectedKey} onSelect={select} onAssign={openAssign} />
          ) : null}
          {day.routes.length === 0 ? (
            <ECard className="p-4" role="status">
              <p className="text-[0.875rem] font-[600]">Nobody is assigned to a job on {longDayLabel(date)}.</p>
              {day.unassigned.length === 0 ? <p className={cn("text-[0.8125rem]", MUTED)}>There are no open jobs on this day either.</p> : null}
            </ECard>
          ) : visibleRoutes.length === 0 && visibleUnassigned.length === 0 ? (
            <p className={cn("text-[0.8125rem]", MUTED)} role="status">Nothing matches &ldquo;{filter.search}&rdquo;.</p>
          ) : null}
          {visibleRoutes.map((route) => (
            <RouteCard
              key={route.cleanerId}
              route={route}
              expanded={isExpanded(route, day.routes.indexOf(route))}
              onToggle={() => setExpanded((current) => ({ ...current, [route.cleanerId]: !isExpanded(route, day.routes.indexOf(route)) }))}
              selectedKey={selectedKey}
              onSelect={select}
            />
          ))}
        </>
      ) : null}
    </div>
  );

  const mapPanel = (
    <div className="min-w-0">
      <ECard className="overflow-hidden">
        <RouteMapCanvas
          pins={pins}
          lines={lines}
          selectedKey={selectedKey}
          onSelect={select}
          mapConfigured={mapConfigured}
          overlay={phone ? null : overlayCard}
          heightClass={MAP_HEIGHT}
          fitKey={`${date}|${filter.show}|${filter.search}|${phone ? phoneView : "desk"}`}
        />
        {day && day.routes.length + day.unassigned.length > 0 ? <MapKey day={day} /> : null}
      </ECard>
    </div>
  );

  return (
    <div className="space-y-5">
      <EPageHeader
        title="Route map"
        description={<><span className="max-sm:hidden">{summary}</span><span className="sm:hidden">{phoneSummary}</span></>}
        actions={<div className="max-sm:hidden"><DateNav date={date} today={today} tomorrow={tomorrow} disabled={false} /></div>}
      />
      <div className="sm:hidden"><DateNav date={date} today={today} tomorrow={tomorrow} disabled={false} /></div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-5 [&>div>*]:h-full" aria-label="The day in figures" role="group">
        <div className="max-sm:hidden"><FactTile label="Cleaner routes" value={facts ? facts.routes : "–"} sub="everyone with a job this day" /></div>
        <FactTile label="Assigned stops" value={facts ? facts.stops : "–"} sub={facts ? `${facts.inProgress} in progress · ${facts.notStarted} not started` : "–"} phone={{ value: facts ? facts.stops : "–", words: "assigned" }} />
        <FactTile label="Nobody on it" isNew className="max-sm:order-first" value={facts ? plural(facts.nobody, "job") : "–"} sub={facts ? (facts.firstNobodyStart ? `first one starts ${facts.firstNobodyStart}` : facts.nobody ? "no start times set" : "every job has a cleaner") : "–"} phone={{ value: facts ? facts.nobody : "–", words: "nobody on it" }} />
        <FactTile label="Driving between stops" value={facts ? travelWords(facts.travelMinutes) : "–"} sub="rough rule, not traffic" phone={{ value: facts ? shortTravel(facts.travelMinutes) : "–", words: "driving, rough" }} />
        <div className="max-sm:hidden">
          <FactTile
            label="Order rule"
            value={day ? (day.groupBySuburb ? "Suburb A to Z, then start time" : "Start time") : "–"}
            sub={<Link href="/v2/admin/settings/scheduling-rules" className="underline-offset-2 hover:underline">Settings › Scheduling rules</Link>}
          />
        </div>
      </div>
      {/* Phones: the route count is in the description; the order rule is one line. */}
      <p className={cn("text-[0.75rem] sm:hidden", MUTED)}>
        Order: {day ? (day.groupBySuburb ? "suburb A to Z, then start time" : "start time") : "–"} · <Link href="/v2/admin/settings/scheduling-rules" className="underline">Scheduling rules</Link>
      </p>

      <div className="sm:hidden" role="group" aria-label="Show the list or the map">
        <div className="flex gap-0.5 rounded-[10px] bg-[hsl(var(--e-muted))] p-[3px]">
          {(["list", "map"] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={phoneView === view}
              onClick={() => setPhoneView(view)}
              className={cn("min-h-11 flex-1 rounded-[8px] text-[0.875rem]", phoneView === view ? "bg-[hsl(var(--e-surface))] font-[600] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-text-secondary))]")}
            >
              {view === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* From lg the list scrolls in its own region so the map stays in view beside it
            (page-level sticky does not work under the portal's overflow-x rule). */}
        <div
          className={cn("min-w-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1", phoneView === "map" && "max-sm:hidden")}
          role="region"
          aria-label="Routes and jobs"
          tabIndex={0}
        >
          {list}
        </div>
        <div className={cn("min-w-0", phoneView === "list" && "max-sm:hidden")}>{mapPanel}</div>
      </div>

      {phone ? (
        <EBottomSheet open={sheetOpen && Boolean(selection)} onOpenChange={setSheetOpen} title={selection ? selectionTitle(selection) : "Stop"} description={selection ? selectionLine(selection) : undefined}>
          {selection ? (
            <div className="space-y-3">
              {selection.kind === "unassigned" && suggestionSentence(selection.job) ? (
                <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-band-info-bg))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-band-info-fg))]">{suggestionSentence(selection.job)}</p>
              ) : null}
              {selection.kind === "stop" ? <p className={cn("text-[0.8125rem]", MUTED)}>{selection.stop.address}, {selection.stop.suburb} · {jobTypeWords(selection.stop.jobType)}</p> : null}
              {selection.kind === "stop" ? <MapsLinks route={selection.route} compact /> : null}
              <SelectionActions selection={selection} onAssign={openAssign} onChange={openChange} large />
            </div>
          ) : null}
        </EBottomSheet>
      ) : null}

      <EPhoneActionBar
        label="Route map actions"
        hidden={!nextToAssign || sheetOpen || Boolean(assign)}
        primary={nextToAssign ? (
          <EButton onClick={() => openAssign(nextToAssign, nextBest?.cleanerId ?? null)}>
            {nextBest ? `Assign ${nextBest.cleanerName.split(/\s+/)[0]} to ${nextToAssign.propertyName}…` : `Choose a cleaner for ${nextToAssign.propertyName}…`}
          </EButton>
        ) : null}
      />

      <AssignDialog
        open={Boolean(assign)}
        target={assign}
        cleaners={day?.cleaners ?? []}
        cleanersState={day ? "ready" : "loading"}
        onClose={() => setAssign(null)}
        onAssigned={() => setReloadToken((value) => value + 1)}
      />
    </div>
  );
}
