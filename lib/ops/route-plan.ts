/**
 * A cleaner's day route, worked out (never stored). Plain module: the server
 * route plan (`lib/ops/dispatch.ts`), the route map API and the route map
 * components all read it; never add "use client" here.
 *
 * Owner defaults (2026-11-17, board "Route map", pending owner confirmation):
 *  - Stops are ordered by start time first. The old order sorted suburbs A to Z
 *    before start times, so a 10:00 clean in Surry Hills could be listed (and
 *    sent to Google Maps) after a 14:30 clean in Potts Point. With the
 *    "group by suburb" setting on, jobs that start at the same time are kept
 *    together by suburb; it no longer outranks the clock.
 *  - Every stop is kept. The "stops per route" setting is now the point above
 *    which a notice appears; the 13th stop onwards is never dropped.
 *  - Travel starts at the first job, never at anyone's home.
 *
 * Travel minutes are the existing rough rule (same suburb / other suburb), not
 * a map estimate.
 */
import { DISPATCH_OTHER_SUBURB_TRAVEL_MIN, DISPATCH_SAME_SUBURB_TRAVEL_MIN } from "@/lib/scheduling-rules/constants";

/** The fields ordering and travel need from a stop. */
export type RouteOrderInput = {
  jobId: string;
  propertyName: string;
  suburb: string;
  startTime: string | null;
  dueTime: string | null;
};

/** Minutes after midnight for "HH:MM"; null for anything else. */
export function clockMinutes(value: string | null | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** A stop without a start time sorts after every timed stop (by its due time when known). */
const NO_TIME = 24 * 60;

function sortMinutes(stop: RouteOrderInput): number {
  return clockMinutes(stop.startTime) ?? NO_TIME + (clockMinutes(stop.dueTime) ?? NO_TIME);
}

function normalisedSuburb(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Start time first; ties by suburb when grouping is on (same-suburb jobs stay
 * together), then by property name and job id so the order is stable.
 */
export function orderRouteStops<T extends RouteOrderInput>(stops: readonly T[], options: { groupBySuburb: boolean }): T[] {
  return [...stops].sort((a, b) => {
    const time = sortMinutes(a) - sortMinutes(b);
    if (time !== 0) return time;
    if (options.groupBySuburb) {
      const suburb = normalisedSuburb(a.suburb).localeCompare(normalisedSuburb(b.suburb));
      if (suburb !== 0) return suburb;
    }
    const name = a.propertyName.localeCompare(b.propertyName);
    return name !== 0 ? name : a.jobId.localeCompare(b.jobId);
  });
}

/** Rough minutes from the previous stop (0 for the first) and the route total. */
export function roughTravel(stops: readonly Pick<RouteOrderInput, "suburb">[]): { fromPrevious: number[]; total: number } {
  const fromPrevious = stops.map((stop, index) => {
    if (index === 0) return 0;
    const previous = stops[index - 1];
    return normalisedSuburb(previous.suburb) === normalisedSuburb(stop.suburb) ? DISPATCH_SAME_SUBURB_TRAVEL_MIN : DISPATCH_OTHER_SUBURB_TRAVEL_MIN;
  });
  return { fromPrevious, total: fromPrevious.reduce((sum, minutes) => sum + minutes, 0) };
}

/** Something about the route's times worth saying out loud. */
export type RouteTimeIssue =
  | { kind: "out_of_order"; stopIndex: number; earlierIndex: number }
  | { kind: "overlap"; stopIndex: number; earlierIndex: number }
  | { kind: "no_start_time"; stopIndex: number };

/**
 * Checks a route in the order it is listed: a stop that starts before an
 * earlier stop (out of time order), a stop that starts before the previous
 * stop is due to finish (times overlap), and stops with no start time.
 * Read-only: it describes the order, it never changes it.
 */
export function routeTimeIssues(stops: readonly Pick<RouteOrderInput, "startTime" | "dueTime">[]): RouteTimeIssue[] {
  const issues: RouteTimeIssue[] = [];
  stops.forEach((stop, index) => {
    const start = clockMinutes(stop.startTime);
    if (start === null) {
      issues.push({ kind: "no_start_time", stopIndex: index });
      return;
    }
    for (let earlier = 0; earlier < index; earlier += 1) {
      const earlierStart = clockMinutes(stops[earlier].startTime);
      if (earlierStart !== null && start < earlierStart) {
        issues.push({ kind: "out_of_order", stopIndex: index, earlierIndex: earlier });
        return;
      }
    }
    if (index > 0) {
      const previousDue = clockMinutes(stops[index - 1].dueTime);
      if (previousDue !== null && start < previousDue) issues.push({ kind: "overlap", stopIndex: index, earlierIndex: index - 1 });
    }
  });
  return issues;
}

/** Google's directions link takes an origin, up to 8 waypoints and a destination. */
export const GOOGLE_MAPS_STOPS_PER_LINK = 10;

/**
 * Splits a route into consecutive Google Maps links of at most
 * GOOGLE_MAPS_STOPS_PER_LINK stops each. Each later link starts at the last
 * stop of the one before, so following them in turn drives the whole route and
 * no stop is left out (the old single link silently kept the first ten).
 */
export function routeLinkChunks<T>(stops: readonly T[], perLink = GOOGLE_MAPS_STOPS_PER_LINK): Array<{ from: number; to: number; stops: T[] }> {
  if (stops.length === 0) return [];
  const size = Math.max(2, perLink);
  const chunks: Array<{ from: number; to: number; stops: T[] }> = [];
  let start = 0;
  while (start < stops.length) {
    const end = Math.min(stops.length, start + size);
    chunks.push({ from: start, to: end - 1, stops: stops.slice(start, end) });
    if (end >= stops.length) break;
    start = end - 1;
  }
  return chunks;
}

/** One Google Maps directions link for at most GOOGLE_MAPS_STOPS_PER_LINK addresses (null when none). */
export function googleMapsDirectionsLink(addresses: readonly string[]): string | null {
  const clean = addresses.map((value) => value.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length > GOOGLE_MAPS_STOPS_PER_LINK) throw new Error("Split the route with routeLinkChunks first.");
  const params = new URLSearchParams({ api: "1", origin: clean[0], destination: clean[clean.length - 1], travelmode: "driving" });
  const waypoints = clean.slice(1, -1);
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** The consecutive links for a whole route, labelled "stops 1–10", "stops 10–14". */
export function routeMapsLinks(addresses: readonly string[]): Array<{ label: string; href: string }> {
  return routeLinkChunks(addresses).flatMap((chunk) => {
    const href = googleMapsDirectionsLink(chunk.stops);
    return href ? [{ label: `stops ${chunk.from + 1}–${chunk.to + 1}`, href }] : [];
  });
}

// ── How a route is drawn ───────────────────────────────────────────────────

/**
 * Each route has its own line pattern as well as colour, so colour is never
 * the only way to tell routes apart. Dash arrays are in units of the line
 * width (SVG stroke-dasharray after multiplying by the width).
 */
export type RouteLinePattern = "solid" | "dashed" | "dotted" | "dash-dot" | "long-dash" | "dash-dot-dot";

export const ROUTE_LINE_PATTERNS: readonly RouteLinePattern[] = ["solid", "dashed", "dotted", "dash-dot", "long-dash", "dash-dot-dot"];

export const ROUTE_PATTERN_WORDS: Record<RouteLinePattern, string> = {
  solid: "solid",
  dashed: "dashed",
  dotted: "dotted",
  "dash-dot": "dash-dot",
  "long-dash": "long dash",
  "dash-dot-dot": "dash-dot-dot",
};

/** Dash and gap lengths, in line widths. Empty = a solid line. */
export const ROUTE_PATTERN_DASHES: Record<RouteLinePattern, readonly number[]> = {
  solid: [],
  dashed: [3, 2],
  dotted: [0.01, 2],
  "dash-dot": [3, 1.6, 0.01, 1.6],
  "long-dash": [6, 2],
  "dash-dot-dot": [3, 1.4, 0.01, 1.4, 0.01, 1.4],
};

/**
 * Route colours from Estate tokens (resolved at run time, so light and
 * Obsidian dark both work). The pattern, the letter and the stop number carry
 * the meaning; the colour only helps.
 */
export const ROUTE_COLOUR_TOKENS: readonly string[] = ["--e-primary", "--e-info", "--e-danger", "--e-gold", "--e-warning", "--e-muted-foreground"];

export type RouteLook = { colourToken: string; pattern: RouteLinePattern };

export function routeLook(index: number): RouteLook {
  const colourToken = ROUTE_COLOUR_TOKENS[index % ROUTE_COLOUR_TOKENS.length];
  // Patterns cycle on their own, then shift by one each full colour cycle, so
  // no two of the first 36 routes share both colour and pattern.
  const cycle = Math.floor(index / ROUTE_COLOUR_TOKENS.length);
  const pattern = ROUTE_LINE_PATTERNS[(index + cycle) % ROUTE_LINE_PATTERNS.length];
  return { colourToken, pattern };
}

function firstLetter(word: string): string {
  return (word.match(/[0-9A-Za-zÀ-￿]/)?.[0] ?? "").toUpperCase();
}

/**
 * The letter each cleaner's pins carry: the first letter of their name, or two
 * letters (first and last name) when two cleaners on the day share it, then a
 * number when even that clashes. Stable for the same names.
 */
export function routeLetters(routes: ReadonlyArray<{ cleanerId: string; cleanerName: string }>): Map<string, string> {
  const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);
  const single = new Map<string, number>();
  for (const route of routes) {
    const letter = firstLetter(words(route.cleanerName)[0] ?? "") || "?";
    single.set(letter, (single.get(letter) ?? 0) + 1);
  }
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const route of routes) {
    const parts = words(route.cleanerName);
    const first = firstLetter(parts[0] ?? "") || "?";
    let letter = single.get(first) === 1 ? first : `${first}${firstLetter(parts[parts.length - 1] ?? "") || ""}`;
    if (used.has(letter)) {
      let suffix = 2;
      while (used.has(`${letter}${suffix}`)) suffix += 1;
      letter = `${letter}${suffix}`;
    }
    used.add(letter);
    result.set(route.cleanerId, letter);
  }
  return result;
}

/** "about 2 h 12 min", "about 44 min", "no driving between stops". */
export function roughDurationWords(minutes: number): string {
  if (minutes <= 0) return "no driving between stops";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `about ${rest} min`;
  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}
