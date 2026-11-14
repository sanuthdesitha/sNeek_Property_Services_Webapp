/**
 * Tour fingerprints (plain module). A fingerprint covers a tour's steps (id,
 * target, since) and the registered targets found on its pages. When a page
 * with a tour gains, loses or renames a target, or a step changes, the
 * fingerprint changes and tests/lib/tutorials-up-to-date.test.ts asks for a
 * version bump with a What's new step, or a "no visible change" reason.
 */
import { TOUR_TARGETS, type TourTargetId } from "./targets";
import type { TourDefinition } from "./types";

export type NoVisibleChange = { fingerprint: string; reason: string; by: string; date: string };

export type FingerprintEntry = {
  version: number;
  fingerprint: string;
  /** Developer notes shown to administrators in Settings › System › Tutorials. */
  noVisibleChange?: NoVisibleChange[];
};

export type FingerprintFile = Record<string, FingerprintEntry>;

function stripQuery(route: string): string {
  return route.split("?")[0];
}

/** The pages a tour runs on (its route and any step routes). */
export function tourPages(tour: TourDefinition): string[] {
  return Array.from(new Set([tour.route, ...tour.steps.map((step) => step.route).filter((route): route is string => Boolean(route))].map(stripQuery)));
}

/** Registered targets on the tour's pages that the source scan found. */
export function pageTargetsInUse(tour: TourDefinition, foundInSource: ReadonlySet<string>): TourTargetId[] {
  const pages = new Set(tourPages(tour));
  return (Object.keys(TOUR_TARGETS) as TourTargetId[])
    .filter((id) => pages.has(TOUR_TARGETS[id].page) && foundInSource.has(id))
    .sort();
}

/** FNV-1a, twice with different seeds: stable, dependency-free, and enough to notice a change. */
function hash(text: string, seed: number): string {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

export function tourFingerprint(tour: TourDefinition, foundInSource: ReadonlySet<string>): string {
  const steps = tour.steps.map((step) => `${step.id}:${step.target ?? "-"}:${step.since}:${step.route ?? ""}`).join("|");
  const targets = pageTargetsInUse(tour, foundInSource).join(",");
  const text = `${tour.key}#${steps}#${targets}`;
  return `${hash(text, 2166136261)}${hash(text, 3735928559)}`;
}
