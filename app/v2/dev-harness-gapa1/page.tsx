"use client";

/**
 * TEMPORARY inspection harness (gapA1, removed after screenshots): the real
 * route pin, line-pattern and suburb pin components on a plain background,
 * because no Google Maps key exists locally. Not the real map.
 */
import { RouteStopPin, PersonPinStack } from "@/components/v2/admin/ops/ops-map-pin-views";
import { groupOverlappingPins } from "@/components/v2/admin/ops/ops-map-pins";
import { routeLook } from "@/lib/ops/route-plan";
import { dashArray, RouteLineSample } from "@/components/v2/admin/jobs/route-map/route-lines";
import { suburbPersonPin } from "@/components/v2/admin/cleaners/home-address-map";

const ROUTES = [
  { letter: "M", name: "Maria", stops: [[-33.8908, 151.2743], [-33.9036, 151.2638], [-33.9205, 151.2571]] },
  { letter: "T", name: "Tom", stops: [[-33.8836, 151.2141], [-33.8775, 151.2193], [-33.8706, 151.2257]] },
  { letter: "G", name: "Grace", stops: [[-33.8798, 151.1857], [-33.8981, 151.1749]] },
  { letter: "S", name: "Sofia", stops: [[-33.8847, 151.2265], [-33.9146, 151.2437]] },
  { letter: "O", name: "Olivia", stops: [[-33.8569, 151.1795], [-33.9105, 151.1551]] },
  { letter: "L", name: "Liam", stops: [[-33.8, 151.27]] },
];
const BOX = { minLat: -33.93, maxLat: -33.79, minLng: 151.14, maxLng: 151.3 };
const W = 640;
const H = 480;
const x = (lng: number) => ((lng - BOX.minLng) / (BOX.maxLng - BOX.minLng)) * W;
const y = (lat: number) => ((BOX.maxLat - lat) / (BOX.maxLat - BOX.minLat)) * H;

const SUBURBS = [
  { cleanerId: "a", initials: "RC", name: "Ruby Chen", suburb: "Balmain", lat: -33.857, lng: 151.18, suburbOnly: false, basis: "suburb_centre" as const },
  { cleanerId: "b", initials: "OB", name: "Olivia Brown", suburb: "Rozelle", lat: -33.861, lng: 151.17, suburbOnly: false, basis: "area_square" as const },
  { cleanerId: "c", initials: "NP", name: "Noah Patel", suburb: "Marrickville", lat: -33.9105, lng: 151.155, suburbOnly: true, basis: "suburb_centre" as const },
  { cleanerId: "d", initials: "MS", name: "Maria Santos", suburb: "Bondi Beach", lat: -33.8908, lng: 151.2743, suburbOnly: false, basis: "suburb_centre" as const },
];

export default function Harness() {
  const groups = groupOverlappingPins(SUBURBS.map((pin) => suburbPersonPin(pin, null)), 13);
  return (
    <div className="space-y-6">
      <h1 className="e-display-md">Pin harness (not the real map)</h1>
      <div className="relative overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]" style={{ width: W, height: H, maxWidth: "100%" }}>
        <svg width={W} height={H} className="absolute inset-0" aria-hidden>
          {ROUTES.map((route, index) => {
            const look = routeLook(index);
            return route.stops.length > 1 ? (
              <polyline key={route.letter} points={route.stops.map(([lat, lng]) => `${x(lng)},${y(lat)}`).join(" ")} fill="none" stroke={`hsl(var(${look.colourToken}))`} strokeWidth={4} strokeLinecap="round" strokeDasharray={dashArray(look.pattern) || undefined} />
            ) : null;
          })}
        </svg>
        {ROUTES.flatMap((route, index) => route.stops.map(([lat, lng], stop) => (
          <div key={`${route.letter}${stop}`} className="absolute" style={{ left: x(lng) - 15, top: y(lat) - 15 }}>
            <RouteStopPin look={{ text: `${route.letter}${stop + 1}`, colourToken: routeLook(index).colourToken, atSuburb: route.letter === "G" && stop === 1, selected: route.letter === "T" && stop === 0 }} ariaLabel={`${route.letter}${stop + 1}`} onActivate={() => undefined} />
          </div>
        )))}
        <div className="absolute" style={{ left: x(151.262) - 15, top: y(-33.8717) - 15 }}>
          <RouteStopPin look={{ text: "?", colourToken: null, atSuburb: false, selected: false }} ariaLabel="nobody" onActivate={() => undefined} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-[0.75rem]">
        {ROUTES.map((route, index) => <span key={route.letter} className="inline-flex items-center gap-1.5"><RouteLineSample lookIndex={index} />{route.name}</span>)}
      </div>
      <div className="relative rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]" style={{ width: W, height: H, maxWidth: "100%" }}>
        {groups.map((group) => (
          <div key={group.id} className="absolute" style={{ left: x(group.lng) - 13, top: y(group.lat), transform: "translateY(calc(-100% + 13px))" }}>
            <PersonPinStack group={group} expanded={false} selectedKey={null} onActivate={() => undefined} onToggle={() => undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
