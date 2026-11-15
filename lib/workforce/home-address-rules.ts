/**
 * Cleaner home addresses: what is on file, what the map may show (plain
 * module: the page loader, the notice and tests).
 *
 * Owner defaults (board "Cleaner home addresses", 2026-11-17, pending owner
 * confirmation): pins sit at SUBURB level only, never on the house; home
 * addresses are not used for suggestions or routes; every opening of the page
 * is written to the activity log (who and when, not the addresses).
 *
 * PRIVACY: a cleaner's stored map position (User.latitude / longitude) never
 * leaves the server. It decides only whether the address was "placed"; the pin
 * is drawn at the suburb centre (from the properties we look after there) or,
 * where we have none, at the centre of a ~2 km grid square.
 */
import { coarseCell, suburbKey, type LatLng } from "@/lib/maps/suburb-centre";

export type HomeAddressStatus = "placed" | "suburb_only" | "not_found" | "nothing";

export type HomeAddressInput = {
  address: string | null;
  suburb: string | null;
  latitude: number | null;
  longitude: number | null;
};

function present(value: string | null | undefined): boolean {
  return Boolean(value && value.trim());
}

function hasPosition(input: Pick<HomeAddressInput, "latitude" | "longitude">): boolean {
  return typeof input.latitude === "number" && Number.isFinite(input.latitude) && typeof input.longitude === "number" && Number.isFinite(input.longitude);
}

/**
 * placed       a stored map position (the profile's address search found it)
 * suburb_only  no street address and no position, but a suburb
 * not_found    a street address that was never placed on the map (too vague)
 * nothing      no address, suburb or position
 */
export function homeAddressStatus(input: HomeAddressInput): HomeAddressStatus {
  if (hasPosition(input)) return "placed";
  if (present(input.address)) return "not_found";
  if (present(input.suburb)) return "suburb_only";
  return "nothing";
}

/** Whose address needs attention (the "Needs attention" filter and the ask). */
export function needsAttention(status: HomeAddressStatus): boolean {
  return status !== "placed";
}

/** The written reason a row is flagged (shown in the name cell). */
export const HOME_ADDRESS_FLAG: Record<Exclude<HomeAddressStatus, "placed">, string> = {
  suburb_only: "No street address",
  not_found: "Could not be placed",
  nothing: "Nothing recorded",
};

export const TRANSPORT_WORDS: Record<string, string> = {
  DRIVING: "Driving",
  WALKING: "Walking",
  TRANSIT: "Public transport",
  BICYCLING: "Cycling",
};

export type HomeAddressPinPlacement = { lat: number; lng: number; basis: "suburb_centre" | "area_square" };

/**
 * Where a cleaner's pin may be drawn, or null for no pin. Never the stored
 * position: a placed address goes to its suburb centre, or the ~2 km square
 * around it when we have no property in that suburb; a suburb-only record goes
 * to the suburb centre when we know one; an address that could not be placed,
 * or nothing at all, gets no pin (its row says why).
 */
export function homeAddressPinPlacement(input: HomeAddressInput, centres: ReadonlyMap<string, LatLng>): HomeAddressPinPlacement | null {
  const status = homeAddressStatus(input);
  if (status === "not_found" || status === "nothing") return null;
  const centre = centres.get(suburbKey(input.suburb));
  if (centre) return { lat: centre.lat, lng: centre.lng, basis: "suburb_centre" };
  if (status === "placed") {
    const cell = coarseCell({ lat: input.latitude as number, lng: input.longitude as number });
    return { ...cell, basis: "area_square" };
  }
  return null;
}

/** "On the map" column words. */
export function onTheMapWords(status: HomeAddressStatus, placement: HomeAddressPinPlacement | null): string {
  if (status === "placed") return placement?.basis === "area_square" ? "Placed, shown by area" : "Placed";
  if (status === "suburb_only") return placement ? "Suburb only" : "Suburb only, not on the map";
  if (status === "not_found") return "Not found";
  return "No";
}
