/**
 * How a route's line is drawn: an SVG sample for the key (and the harness),
 * and Google Maps polyline options built from the same dash pattern, so the
 * key and the map always agree. Patterns come from `lib/ops/route-plan.ts`.
 */
import { ROUTE_PATTERN_DASHES, ROUTE_PATTERN_WORDS, routeLook, type RouteLinePattern } from "@/lib/ops/route-plan";

/** Line width on the map and in the key, in px. */
export const ROUTE_LINE_WIDTH = 4;

/** SVG stroke-dasharray for a pattern at a line width ("" for solid). */
export function dashArray(pattern: RouteLinePattern, width = ROUTE_LINE_WIDTH): string {
  return ROUTE_PATTERN_DASHES[pattern].map((value) => Math.max(value * width, 0.01).toFixed(2)).join(" ");
}

/** A short line in the route's colour and pattern (decorative; the words beside it carry the meaning). */
export function RouteLineSample({ lookIndex, width = 30 }: { lookIndex: number; width?: number }) {
  const look = routeLook(lookIndex);
  return (
    <svg aria-hidden width={width} height={10} viewBox={`0 0 ${width} 10`} className="shrink-0" data-pattern={look.pattern}>
      <line
        x1={2}
        y1={5}
        x2={width - 2}
        y2={5}
        stroke={`hsl(var(${look.colourToken}))`}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={dashArray(look.pattern, 3) || undefined}
      />
    </svg>
  );
}

export function patternWords(lookIndex: number): string {
  return ROUTE_PATTERN_WORDS[routeLook(lookIndex).pattern];
}

/** "158 42% 20%" (an Estate token value) → "hsl(158, 42%, 20%)" for Google Maps. */
export function tokenToCss(value: string): string | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  return `hsl(${parts.slice(0, 3).join(", ")})`;
}

/** Reads an Estate colour token where the map lives (light or Obsidian dark). */
export function resolveRouteColour(element: Element | null, token: string): string {
  if (!element || typeof window === "undefined") return "#1f3d33";
  return tokenToCss(window.getComputedStyle(element).getPropertyValue(token)) ?? "#1f3d33";
}

/* Google Maps has no types installed in this project; the handles stay opaque. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type MapsHandle = any;

/**
 * Polyline options for a route: a solid stroke, or (for the other patterns)
 * repeated symbols on an invisible stroke, which is how Google Maps draws
 * dashes and dots.
 */
export function polylineOptions(g: MapsHandle, pattern: RouteLinePattern, colour: string, path: Array<{ lat: number; lng: number }>) {
  const dashes = ROUTE_PATTERN_DASHES[pattern];
  const base = { path, geodesic: false, clickable: false, strokeColor: colour, strokeWeight: ROUTE_LINE_WIDTH, zIndex: 2 };
  if (dashes.length === 0) return { ...base, strokeOpacity: 0.9 };
  const unit = ROUTE_LINE_WIDTH;
  const repeat = dashes.reduce((sum, value) => sum + value, 0) * unit;
  const icons: MapsHandle[] = [];
  let offset = 0;
  dashes.forEach((value, index) => {
    const length = value * unit;
    if (index % 2 === 0) {
      const dot = value < 0.1;
      icons.push({
        icon: dot
          ? { path: g.maps.SymbolPath.CIRCLE, fillColor: colour, fillOpacity: 1, strokeOpacity: 0, scale: unit / 2 }
          : { path: `M 0,${-value / 2} 0,${value / 2}`, strokeColor: colour, strokeOpacity: 0.9, strokeWeight: unit, scale: unit },
        offset: `${(offset + length / 2).toFixed(1)}px`,
        repeat: `${repeat.toFixed(1)}px`,
      });
    }
    offset += length;
  });
  return { ...base, strokeOpacity: 0, icons };
}
