/**
 * Canonical Google Maps URL builders.
 *
 * The problem these solve: a free-text query like "Richmond" (suburb only, no
 * state) geocodes to the wrong state, and even a street address can resolve to a
 * nearby pin instead of the exact unit the user picked. So we ALWAYS prefer the
 * precise data captured when the address was selected in the autocomplete:
 *
 *   1. placeId  — opens the exact selected place (best).
 *   2. lat/lng  — opens the exact rooftop pin.
 *   3. full text — address + suburb + STATE + postcode + ", Australia" (fallback
 *      that at least disambiguates the state/country).
 */

export type MapLocation = {
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  name?: string | null;
};

function hasCoords(loc: MapLocation): loc is MapLocation & { latitude: number; longitude: number } {
  return (
    typeof loc.latitude === "number" &&
    Number.isFinite(loc.latitude) &&
    typeof loc.longitude === "number" &&
    Number.isFinite(loc.longitude)
  );
}

/** Full, state-qualified address text (always ends in ", Australia"). */
export function fullAddressText(loc: MapLocation): string {
  const stateLine = [loc.state, loc.postcode]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(" ");
  const parts = [loc.address, loc.suburb, stateLine]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean);
  const text = parts.join(", ");
  if (!text) return "";
  return /australia/i.test(text) ? text : `${text}, Australia`;
}

function coordStr(loc: MapLocation): string | null {
  return hasCoords(loc) ? `${loc.latitude},${loc.longitude}` : null;
}

/**
 * A "view / search" maps URL that pins the exact selected place when possible.
 * Returns "" when there's nothing usable to search for.
 */
export function googleMapsSearchUrl(loc: MapLocation): string {
  const coords = coordStr(loc);
  const text = fullAddressText(loc);
  const query = coords ?? text;
  if (!query) return "";
  let url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  if (loc.placeId) url += `&query_place_id=${encodeURIComponent(loc.placeId)}`;
  return url;
}

/**
 * A turn-by-turn "directions to" maps URL that targets the exact selected place
 * when possible. Returns "" when there's no usable destination.
 */
export function googleMapsDirectionsUrl(loc: MapLocation): string {
  const coords = coordStr(loc);
  const text = fullAddressText(loc);
  const destination = coords ?? text;
  if (!destination) return "";
  let url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  if (loc.placeId) url += `&destination_place_id=${encodeURIComponent(loc.placeId)}`;
  return url;
}
