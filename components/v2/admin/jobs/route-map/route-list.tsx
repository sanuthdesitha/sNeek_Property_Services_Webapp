"use client";

/**
 * The route map's list: "Nobody on these jobs" first (with the existing
 * scorer's suggestion, read only), then one card per cleaner's route with
 * every stop. Every function the old cards had stays: status, address, job
 * type, times, minutes from the previous stop, Open job, Maps and the
 * multi-stop Google Maps link (now split into consecutive links above ten
 * stops, so none is left out).
 */
import type * as React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import { routeLook } from "@/lib/ops/route-plan";
import { routeInkToken } from "@/components/v2/admin/ops/ops-map-pin-views";
import type { RouteMapRoute, RouteMapStop, RouteMapSuggestion, RouteMapSuggestionState, RouteMapUnassignedJob } from "@/lib/ops/route-map-types";
import { jobTypeWords, routeFlag, statusWords, stopKey, timeRange, travelWords, unassignedKey } from "./route-map-model";

const MUTED = "text-[hsl(var(--e-text-secondary))]";
const ROW_SELECTED = "bg-[hsl(var(--e-primary-soft))]";

function statusTone(status: string): EPillTone {
  if (status === "IN_PROGRESS" || status === "EN_ROUTE") return "ok";
  if (status === "PAUSED" || status === "WAITING_CONTINUATION_APPROVAL") return "warn";
  return "neutral";
}

/** The round letter badge in the route's colour (decorative; the name sits beside it). */
export function RouteLetter({ route, size = "md" }: { route: Pick<RouteMapRoute, "letter" | "lookIndex">; size?: "sm" | "md" }) {
  const look = routeLook(route.lookIndex);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold", size === "md" ? "h-7 w-7 text-[0.75rem]" : "h-6 w-6 text-[0.6875rem]")}
      style={{ backgroundColor: `hsl(var(${look.colourToken}))`, color: `hsl(var(${routeInkToken(look.colourToken)}))` }}
    >
      {route.letter}
    </span>
  );
}

function UnassignedGlyph() {
  return (
    <span aria-hidden className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
      <span className="absolute inset-[3px] rotate-45 rounded-[3px] border-2 border-[hsl(var(--e-foreground))] bg-[hsl(var(--e-surface))]" />
      <span className="relative text-[0.6875rem] font-bold">?</span>
    </span>
  );
}

// ── Suggestions ────────────────────────────────────────────────────────────

function SuggestionChips({ best }: { best: RouteMapSuggestion }) {
  const chips = [
    best.qaScore === null ? "QA no reviews yet" : `QA ${best.qaScore.toFixed(1)}`,
    `Suburb history ${best.suburbHistory}`,
    `Today's load ${best.load}/${best.maxDailyJobs}`,
  ];
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((chip) => <EPill key={chip}>{chip}</EPill>)}
      <EPill tone={best.availabilityFits ? "neutral" : "warn"}>{best.availabilityFits ? "Availability fits" : "Availability may not fit"}</EPill>
    </div>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function SuggestionBox({ suggestion, limit }: { suggestion: RouteMapSuggestionState; limit: number }) {
  const box = "mt-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem]";
  switch (suggestion.state) {
    case "picked":
      return (
        <div className={box}>
          <p><span className="font-[600]">Suggested: {suggestion.best.cleanerName}</span><span className={MUTED}> · score {Math.round(suggestion.best.score)}</span></p>
          <SuggestionChips best={suggestion.best} />
        </div>
      );
    case "best_only":
      return (
        <div className={box}>
          <p><span className="font-[600]">Best match: {suggestion.best.cleanerName}</span><span className={MUTED}> · score {Math.round(suggestion.best.score)} · not picked for you</span></p>
          <SuggestionChips best={suggestion.best} />
        </div>
      );
    case "none":
      return <p className={cn(box, MUTED)}>No active cleaner to suggest.</p>;
    case "off":
      return <p className={cn(box, MUTED)}>Automatic suggestions are switched off in Settings. Choose… lists every cleaner.</p>;
    case "not_checked":
      return <p className={cn(box, MUTED)}>Not worked out: suggestions cover the first {limit} jobs with nobody on them. Choose… lists every cleaner.</p>;
    default:
      return <p className={cn(box, "text-[hsl(var(--e-band-problem-fg))]")} role="status">The suggestion could not be worked out. Choose… still works.</p>;
  }
}

export function suggestedCleaner(suggestion: RouteMapSuggestionState): RouteMapSuggestion | null {
  return suggestion.state === "picked" ? suggestion.best : null;
}

export function UnassignedCard({
  jobs,
  limit,
  selectedKey,
  onSelect,
  onAssign,
}: {
  jobs: RouteMapUnassignedJob[];
  limit: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onAssign: (job: RouteMapUnassignedJob, suggestedId: string | null) => void;
}) {
  return (
    <EToneCard
      tone="attention"
      aria-label="Nobody on these jobs"
      header={(
        <div>
          <h2 className="text-[0.9375rem] font-[650]">Nobody on these jobs</h2>
          <p className="text-[0.75rem] opacity-90 max-sm:hidden">{jobs.length} job{jobs.length === 1 ? "" : "s"} on this day {jobs.length === 1 ? "has" : "have"} no cleaner. Suggestions use today&apos;s load, QA score, suburb history and availability.</p>
        </div>
      )}
      pill={`${jobs.length} to assign`}
      bodyClassName="px-0 py-0"
    >
      <ul className="divide-y divide-[hsl(var(--e-border))]">
        {jobs.map((job) => {
          const key = unassignedKey(job.jobId);
          const best = suggestedCleaner(job.suggestion);
          return (
            <li key={job.jobId} id={key} className={cn("px-3.5 py-3", selectedKey === key && ROW_SELECTED)}>
              <div className="flex flex-wrap items-start gap-3">
                <UnassignedGlyph />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => onSelect(key)} aria-pressed={selectedKey === key} className="text-left text-[0.875rem] font-[650] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
                      {job.propertyName}
                    </button>
                    <EPill>{jobTypeWords(job.jobType)}</EPill>
                  </div>
                  <p className={cn("text-[0.75rem]", MUTED)}>
                    <span className="max-sm:hidden">{job.address}, {job.suburb} · </span>
                    {timeRange(job.startTime, job.dueTime)}
                    {job.guestCheckinTime ? ` · guests in ${job.guestCheckinTime}` : ""}
                    <span className="sm:hidden"> · nobody on it</span>
                  </p>
                  {!job.position ? <p className={cn("text-[0.75rem]", MUTED)}>Not on the map: no saved position for this property or its suburb.</p> : job.position.precision === "suburb" ? <p className={cn("text-[0.75rem]", MUTED)}>No saved map position: its pin sits at the {job.suburb} centre.</p> : null}
                  <SuggestionBox suggestion={job.suggestion} limit={limit} />
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 max-sm:w-full max-sm:flex-row">
                  {best ? (
                    <EButton size="sm" className="max-sm:flex-1" onClick={() => onAssign(job, best.cleanerId)}>Assign {firstName(best.cleanerName)}…</EButton>
                  ) : null}
                  <EButton size="sm" variant="outline" className="max-sm:flex-1" onClick={() => onAssign(job, null)} aria-label={`Choose a cleaner for ${job.propertyName}`}>Choose…</EButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className={cn("border-t border-[hsl(var(--e-border))] px-3.5 py-2.5 text-[0.75rem] max-sm:hidden", MUTED)}>
        &ldquo;Assign…&rdquo; opens the job&apos;s own assign window with the suggestion ticked, so the cleaner is told as from the job page and the job keeps its history. Nothing is assigned from the map, and nothing is dragged.
      </p>
    </EToneCard>
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────

function travelLine(stop: RouteMapStop, index: number, previous: RouteMapStop | undefined): string {
  if (index === 0 || !previous) return "First stop of the run";
  const same = previous.suburb === stop.suburb;
  return `About ${stop.travelFromPrevious} min from stop ${index} (${same ? "same suburb" : "different suburb"})`;
}

const RULES_HREF = "/v2/admin/settings/scheduling-rules";

/** A link to the rule, so the owner can change it themselves. */
function RuleLink({ children }: { children: React.ReactNode }) {
  return <Link href={RULES_HREF} className="font-[600] underline underline-offset-2">{children}</Link>;
}

function StopRow({ route, stop, index, selected, onSelect }: { route: RouteMapRoute; stop: RouteMapStop; index: number; selected: boolean; onSelect: (key: string) => void }) {
  const key = stopKey(route.cleanerId, stop.jobId);
  const issue = route.timeIssues.find((item) => item.stopIndex === index && item.kind !== "no_start_time");
  return (
    <li id={key} className={cn("flex gap-3 px-3.5 py-3 max-sm:py-2.5", selected && ROW_SELECTED)}>
      <span className="w-5 shrink-0 pt-0.5 text-[0.8125rem] font-[650] tabular-nums">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onSelect(key)} aria-pressed={selected} className="min-w-0 text-left text-[0.875rem] font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] max-sm:flex-1">
            {stop.propertyName}
          </button>
          <EPill tone={statusTone(stop.status)} className="max-sm:hidden">{statusWords(stop.status)}</EPill>
          <span className="text-[0.8125rem] tabular-nums sm:hidden">{stop.startTime ?? "no time"}</span>
        </div>
        <p className={cn("text-[0.75rem] max-sm:hidden", MUTED)}>
          {stop.address}, {stop.suburb} · {jobTypeWords(stop.jobType)} · <span className={issue ? "font-[650] text-[hsl(var(--e-foreground))]" : undefined}>{timeRange(stop.startTime, stop.dueTime)}</span>
        </p>
        <p className={cn("text-[0.75rem] max-sm:hidden", MUTED)}>{travelLine(stop, index, route.stops[index - 1])}</p>
        {!stop.position ? <p className={cn("text-[0.75rem] max-sm:hidden", MUTED)}>Not on the map: no saved position for this property or its suburb.</p> : stop.position.precision === "suburb" ? <p className={cn("text-[0.75rem] max-sm:hidden", MUTED)}>No saved map position: its pin sits at the {stop.suburb} centre.</p> : null}
      </div>
      <div className="flex shrink-0 items-start gap-1.5 max-sm:hidden">
        <EButton asChild size="sm" variant="ghost"><Link href={`/v2/admin/jobs/${stop.jobId}`}>Open job</Link></EButton>
        {stop.mapsHref ? (
          <EButton asChild size="sm" variant="outline">
            <a href={stop.mapsHref} target="_blank" rel="noreferrer" aria-label={`Maps: ${stop.propertyName} (opens Google Maps)`}>Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden /></a>
          </EButton>
        ) : null}
      </div>
    </li>
  );
}

function routeSummary(route: RouteMapRoute, flagSummary: string | null): string {
  const count = route.hiddenStopCount > 0 ? `${route.stops.length} of ${route.stops.length + route.hiddenStopCount} stops shown` : `${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}`;
  const travel = route.stops.length < 2 && route.hiddenStopCount === 0 ? "no driving between stops" : `${travelWords(route.totalTravelMinutes)} driving between stops`;
  return [count, travel, flagSummary].filter(Boolean).join(" · ");
}

function collapsedSummary(route: RouteMapRoute): string {
  const names = route.stops.slice(0, 3).map((stop) => `${stop.propertyName}${stop.startTime ? ` ${stop.startTime}` : ""}`);
  const more = route.stops.length > 3 ? ` and ${route.stops.length - 3} more` : "";
  const travel = route.stops.length < 2 ? "no driving between stops" : travelWords(route.totalTravelMinutes);
  return `${route.stops.length} stop${route.stops.length === 1 ? "" : "s"} · ${names.join(", ")}${more} · ${travel}`;
}

/** "3 stops", or "the 12 shown stops" when the rule hides some. */
function linkCoverage(route: RouteMapRoute): string {
  const count = `${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}`;
  return route.hiddenStopCount > 0 ? `the ${count} shown` : count;
}

export function MapsLinks({ route, compact = false }: { route: RouteMapRoute; compact?: boolean }) {
  if (route.mapsLinks.length === 0) return null;
  if (route.mapsLinks.length === 1) {
    const coverage = linkCoverage(route);
    return (
      <EButton asChild size="sm" variant="outline">
        <a href={route.mapsLinks[0].href} target="_blank" rel="noreferrer" aria-label={`Open ${route.cleanerName}'s route in Google Maps, ${coverage}`}>
          {compact ? `Route in Maps (${coverage})` : `Open route in Google Maps (${coverage})`} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </EButton>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {route.mapsLinks.map((link) => (
        <EButton key={link.href} asChild size="sm" variant="outline">
          <a href={link.href} target="_blank" rel="noreferrer" aria-label={`Open ${route.cleanerName}'s route in Google Maps, ${link.label}`}>
            Maps, {link.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </EButton>
      ))}
    </div>
  );
}

export function RouteCard({
  route,
  expanded,
  onToggle,
  selectedKey,
  onSelect,
}: {
  route: RouteMapRoute;
  expanded: boolean;
  onToggle: () => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const flag = routeFlag(route);
  const noTime = route.timeIssues.filter((issue) => issue.kind === "no_start_time").length;
  const outOfOrder = route.timeIssues.find((issue) => issue.kind === "out_of_order");
  const overlap = route.timeIssues.find((issue) => issue.kind === "overlap");
  const titleId = `route-${route.cleanerId}`;
  return (
    <EToneCard
      tone={flag ? "attention" : null}
      aria-labelledby={titleId}
      header={(
        <div className="flex min-w-0 items-start gap-2.5">
          <RouteLetter route={route} />
          <div className="min-w-0">
            <h2 id={titleId} className="text-[0.9375rem] font-[650]">{route.cleanerName}</h2>
            <p className="text-[0.75rem] opacity-90">{expanded ? routeSummary(route, flag?.summary ?? null) : collapsedSummary(route)}</p>
          </div>
        </div>
      )}
      pill={flag?.pill}
      headerClassName="pb-2.5"
      bodyClassName="px-0 pb-0 pt-0"
    >
      <div className="flex flex-wrap items-center gap-2 px-3.5 pb-3">
        {expanded ? <MapsLinks route={route} /> : null}
        <EButton size="sm" variant="ghost" onClick={onToggle} aria-expanded={expanded} aria-controls={`${titleId}-stops`}>
          {expanded ? "Hide stops" : "Show stops"}
        </EButton>
      </div>
      <div id={`${titleId}-stops`} hidden={!expanded}>
        {route.hiddenStopCount > 0 ? (
          <EToneNotice tone="attention" className="mx-3.5 mb-3 rounded-[var(--e-radius)] px-3 py-2 text-[0.75rem]">
            {route.hiddenStopCount} more stop{route.hiddenStopCount === 1 ? " is" : "s are"} not shown — the rule &lsquo;Routes: stops shown&rsquo; is set to {route.stopLimit}. They are not on the map or in the Google Maps link. <RuleLink>Settings › Scheduling rules</RuleLink>
          </EToneNotice>
        ) : null}
        <ol className="divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))]">
          {route.stops.map((stop, index) => (
            <StopRow key={stop.jobId} route={route} stop={stop} index={index} selected={selectedKey === stopKey(route.cleanerId, stop.jobId)} onSelect={onSelect} />
          ))}
        </ol>
        {outOfOrder ? (
          <EToneNotice tone="info" className="mx-3.5 my-3 rounded-[var(--e-radius)] px-3 py-2 text-[0.75rem]">
            Grouped by suburb: a {route.stops[outOfOrder.stopIndex].startTime} stop comes after a {route.stops[outOfOrder.earlierIndex].startTime} stop. This is the rule &lsquo;Routes: group by suburb&rsquo;, which can be changed in <RuleLink>Settings › Scheduling rules</RuleLink>.
          </EToneNotice>
        ) : null}
        {overlap ? (
          <EToneNotice tone="attention" className="mx-3.5 my-3 rounded-[var(--e-radius)] px-3 py-2 text-[0.75rem]">
            {`${route.stops[overlap.stopIndex].propertyName} starts at ${route.stops[overlap.stopIndex].startTime}, before ${route.stops[overlap.earlierIndex].propertyName} is due to finish at ${route.stops[overlap.earlierIndex].dueTime}. Check the times or change a cleaner.`}
          </EToneNotice>
        ) : null}
        {noTime > 0 ? (
          <p className={cn("px-3.5 py-2.5 text-[0.75rem]", MUTED)}>{noTime} stop{noTime === 1 ? " has" : "s have"} no start time; the route order treats {noTime === 1 ? "it" : "them"} as 23:59.</p>
        ) : null}
      </div>
    </EToneCard>
  );
}
