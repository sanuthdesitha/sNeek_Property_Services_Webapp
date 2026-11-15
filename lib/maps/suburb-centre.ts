/**
 * Suburb-level map positions without geocoding (plain module: server and
 * tests). sNeek has no suburb boundary data and no server-side geocoder call
 * per page view, so a suburb's "centre" is the average position of the active
 * properties we look after in that suburb (business addresses already shown
 * to the office). Used by:
 *  - the route map, for a property saved without a placed address (its pin
 *    sits at the suburb centre and says so);
 *  - Cleaner home addresses, where a pin must never sit on the house.
 *
 * `coarseCell` is the fallback for a home address in a suburb where we have no
 * property: the centre of a fixed grid square of about 2 km, so the pin shows
 * the area, never the house.
 */

export type SuburbPositionSource = { suburb: string | null | undefined; latitude: number | null | undefined; longitude: number | null | undefined };

export type LatLng = { lat: number; lng: number };

export function suburbKey(suburb: string | null | undefined): string {
  return (suburb ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Average position per suburb (key from `suburbKey`), from rows that have both coordinates. */
export function suburbCentres(rows: readonly SuburbPositionSource[]): Map<string, LatLng> {
  const sums = new Map<string, { lat: number; lng: number; count: number }>();
  for (const row of rows) {
    const key = suburbKey(row.suburb);
    if (!key || !finite(row.latitude) || !finite(row.longitude)) continue;
    const entry = sums.get(key) ?? { lat: 0, lng: 0, count: 0 };
    entry.lat += row.latitude;
    entry.lng += row.longitude;
    entry.count += 1;
    sums.set(key, entry);
  }
  const centres = new Map<string, LatLng>();
  sums.forEach((entry, key) => centres.set(key, { lat: round(entry.lat / entry.count, 5), lng: round(entry.lng / entry.count, 5) }));
  return centres;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Grid size in degrees (about 2.2 km north–south, 1.8 km east–west in Sydney). */
export const COARSE_CELL_DEGREES = 0.02;

/** The centre of the ~2 km grid square holding this position. Never the position itself. */
export function coarseCell(position: LatLng): LatLng {
  const snap = (value: number) => round((Math.floor(value / COARSE_CELL_DEGREES) + 0.5) * COARSE_CELL_DEGREES, 4);
  return { lat: snap(position.lat), lng: snap(position.lng) };
}
