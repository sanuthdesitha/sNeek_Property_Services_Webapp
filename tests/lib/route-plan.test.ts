// @vitest-environment node
/**
 * Route order and links (board "Route map", 2026-11-17; owner defaults pending
 * confirmation): start time first (the old suburb A-to-Z sort put a 10:00 job
 * last), every stop kept, the Google Maps link split into consecutive links
 * instead of silently keeping the first ten.
 */
import { describe, expect, it } from "vitest";
import {
  GOOGLE_MAPS_STOPS_PER_LINK, ROUTE_LINE_PATTERNS, clockMinutes, googleMapsDirectionsLink, orderRouteStops, roughDurationWords,
  roughTravel, routeLetters, routeLinkChunks, routeLook, routeMapsLinks, routeTimeIssues,
} from "@/lib/ops/route-plan";

const stop = (jobId: string, propertyName: string, suburb: string, startTime: string | null, dueTime: string | null = null) => ({ jobId, propertyName, suburb, startTime, dueTime });

describe("route order", () => {
  const tom = [
    stop("j1", "Darlinghurst Terrace", "Darlinghurst", "12:00", "14:00"),
    stop("j2", "Potts Point Apartment", "Potts Point", "14:30", "16:30"),
    stop("j3", "Surry Hills Studio", "Surry Hills", "10:00", "12:00"),
  ];

  it("puts the 10:00 job first, not last (the board's Tom Nguyen case)", () => {
    expect(orderRouteStops(tom, { groupBySuburb: true }).map((item) => item.startTime)).toEqual(["10:00", "12:00", "14:30"]);
    expect(orderRouteStops(tom, { groupBySuburb: false }).map((item) => item.jobId)).toEqual(["j3", "j1", "j2"]);
  });

  it("keeps same-suburb jobs together only among jobs that start at the same time", () => {
    const tied = [stop("a", "Zeta", "Bondi", "09:00"), stop("b", "Alpha", "Coogee", "09:00"), stop("c", "Beta", "Bondi", "09:00")];
    expect(orderRouteStops(tied, { groupBySuburb: true }).map((item) => item.jobId)).toEqual(["c", "a", "b"]);
    expect(orderRouteStops(tied, { groupBySuburb: false }).map((item) => item.jobId)).toEqual(["b", "c", "a"]);
  });

  it("lists stops without a start time last, by due time, and never drops one", () => {
    const stops = [stop("a", "A", "X", null, "15:00"), stop("b", "B", "X", null, null), stop("c", "C", "X", "11:00")];
    expect(orderRouteStops(stops, { groupBySuburb: true }).map((item) => item.jobId)).toEqual(["c", "a", "b"]);
  });

  it("reads only HH:MM clock times", () => {
    expect(clockMinutes("09:30")).toBe(570);
    expect(clockMinutes("9:30")).toBeNull();
    expect(clockMinutes("24:10")).toBeNull();
    expect(clockMinutes(null)).toBeNull();
  });
});

describe("rough travel and time issues", () => {
  it("is the rough rule from the first job: 8 in a suburb, 22 between", () => {
    const travel = roughTravel([{ suburb: "Bondi" }, { suburb: "bondi " }, { suburb: "Coogee" }]);
    expect(travel.fromPrevious).toEqual([0, 8, 22]);
    expect(travel.total).toBe(30);
    expect(roughDurationWords(132)).toBe("about 2 h 12 min");
    expect(roughDurationWords(0)).toBe("no driving between stops");
  });

  it("flags out of time order, overlaps and missing start times without reordering", () => {
    const issues = routeTimeIssues([
      { startTime: "12:00", dueTime: "14:00" },
      { startTime: "13:30", dueTime: "15:00" },
      { startTime: "10:00", dueTime: "12:00" },
      { startTime: null, dueTime: null },
    ]);
    expect(issues).toEqual([
      { kind: "overlap", stopIndex: 1, earlierIndex: 0 },
      { kind: "out_of_order", stopIndex: 2, earlierIndex: 0 },
      { kind: "no_start_time", stopIndex: 3 },
    ]);
    expect(routeTimeIssues([{ startTime: "09:00", dueTime: "11:00" }, { startTime: "11:30", dueTime: "13:30" }])).toEqual([]);
  });
});

describe("Google Maps links", () => {
  it("covers every one of 14 stops with consecutive links that share their joining stop", () => {
    const addresses = Array.from({ length: 14 }, (_, index) => `${index + 1} Test St, Bondi`);
    const chunks = routeLinkChunks(addresses);
    expect(chunks.map((chunk) => [chunk.from, chunk.to])).toEqual([[0, 9], [9, 13]]);
    const covered = new Set(chunks.flatMap((chunk) => chunk.stops));
    expect(covered.size).toBe(14);
    const links = routeMapsLinks(addresses);
    expect(links.map((link) => link.label)).toEqual(["stops 1–10", "stops 10–14"]);
    const first = new URL(links[0].href);
    expect(first.searchParams.get("origin")).toBe("1 Test St, Bondi");
    expect(first.searchParams.get("destination")).toBe("10 Test St, Bondi");
    expect(first.searchParams.get("waypoints")?.split("|")).toHaveLength(8);
    expect(new URL(links[1].href).searchParams.get("origin")).toBe("10 Test St, Bondi");
  });

  it("keeps one link for ten stops or fewer and refuses to silently cut a longer one", () => {
    expect(routeMapsLinks(["a", "b", "c"])).toHaveLength(1);
    expect(routeLinkChunks(Array.from({ length: GOOGLE_MAPS_STOPS_PER_LINK }, (_, i) => i))).toHaveLength(1);
    expect(() => googleMapsDirectionsLink(Array.from({ length: 11 }, (_, i) => `s${i}`))).toThrow();
    expect(routeMapsLinks([])).toEqual([]);
  });
});

describe("route look", () => {
  it("gives each route its own pattern as well as colour", () => {
    const looks = Array.from({ length: ROUTE_LINE_PATTERNS.length }, (_, index) => routeLook(index));
    expect(new Set(looks.map((look) => look.pattern)).size).toBe(ROUTE_LINE_PATTERNS.length);
    const pairs = new Set(Array.from({ length: 36 }, (_, index) => `${routeLook(index).colourToken}|${routeLook(index).pattern}`));
    expect(pairs.size).toBe(36);
  });

  it("uses one letter per cleaner and two when first letters clash", () => {
    const letters = routeLetters([
      { cleanerId: "1", cleanerName: "Maria Santos" },
      { cleanerId: "2", cleanerName: "Tom Nguyen" },
      { cleanerId: "3", cleanerName: "Mia Kim" },
    ]);
    expect(letters.get("2")).toBe("T");
    expect(letters.get("1")).toBe("MS");
    expect(letters.get("3")).toBe("MK");
  });
});
