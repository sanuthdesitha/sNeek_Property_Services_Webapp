"use client";

import { Loader } from "@googlemaps/js-api-loader";
import { resolveBrowserMapsKey } from "@/lib/maps/loader";
import type { AddressResult } from "./types";

// We do not depend on @types/google.maps; the SDK is loaded at runtime and
// shaped with the small `any` surface area we need below.

let loaderPromise: Promise<any> | null = null;
let runtimeAuthError: string | null = null;

// Google Maps surfaces auth/quota/referrer failures via a global callback,
// NOT via the loader.load() promise. We capture it here so loadPlacesLibrary()
// can fail loudly even when load() itself "succeeded".
if (typeof window !== "undefined") {
  (window as any).gm_authFailure = () => {
    runtimeAuthError =
      "Google Maps auth failed (gm_authFailure). Check API key validity, " +
      "HTTP-referrer restrictions, billing, and that Places API (New) + Maps JavaScript API are enabled.";
  };
}

function getLoader(): Promise<any> {
  if (loaderPromise) return loaderPromise;
  loaderPromise = (async () => {
    // Build-time key first, then the runtime /api/public/maps-config fallback
    // so address autocomplete + maps work in production builds.
    const apiKey = await resolveBrowserMapsKey();
    if (!apiKey) {
      throw new Error(
        "Google Maps key not configured. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (or the " +
          "server-side GOOGLE_MAPS_API_KEY used by /api/public/maps-config)."
      );
    }
    const loader = new Loader({
      apiKey,
      version: "weekly",
      libraries: ["places", "marker"],
    });
    return loader.load();
  })();
  return loaderPromise;
}

/**
 * Loads the Places library via google.maps.importLibrary so we get the
 * new API surface (including PlaceAutocompleteElement) backed by
 * "Places API (New)" in Google Cloud Console.
 */
export async function loadPlacesLibrary(): Promise<any> {
  await getLoader();
  // Give Google a tick to fire gm_authFailure if the key is bad
  await new Promise((r) => setTimeout(r, 50));
  if (runtimeAuthError) throw new Error(runtimeAuthError);
  const g: any = (window as any).google;
  if (!g?.maps?.importLibrary) {
    throw new Error(
      "Google Maps SDK loaded without importLibrary support. " +
        "Ensure the loader is using a recent 'weekly' version."
    );
  }
  const places = await g.maps.importLibrary("places");
  if (!places) {
    throw new Error(
      "Places library failed to load. Ensure 'Places API (New)' is enabled in the Google Cloud Console."
    );
  }
  return places;
}

/**
 * Loads the Maps library for rendering maps. Used by ops live-map +
 * properties-map.
 */
export async function loadMapsLibrary(): Promise<any> {
  await getLoader();
  await new Promise((r) => setTimeout(r, 50));
  if (runtimeAuthError) throw new Error(runtimeAuthError);
  const g: any = (window as any).google;
  if (!g?.maps?.importLibrary) {
    throw new Error("Google Maps SDK missing importLibrary; cannot load maps library.");
  }
  return g.maps.importLibrary("maps");
}

/**
 * Loads the marker library (AdvancedMarkerElement, etc.).
 */
export async function loadMarkerLibrary(): Promise<any> {
  await getLoader();
  if (runtimeAuthError) throw new Error(runtimeAuthError);
  const g: any = (window as any).google;
  if (!g?.maps?.importLibrary) {
    throw new Error("Google Maps SDK missing importLibrary; cannot load marker library.");
  }
  return g.maps.importLibrary("marker");
}

const COMPONENT_LOOKUPS: Record<string, keyof AddressResult> = {
  subpremise: "unit",
  street_number: "streetNumber",
  route: "route",
  locality: "suburb",
  postal_town: "suburb",
  sublocality_level_1: "suburb",
  administrative_area_level_1: "state",
  postal_code: "postcode",
  country: "country",
};

/**
 * Parse a legacy `google.maps.places.PlaceResult` shape.
 * Kept for backward compat — the new PlaceAutocompleteElement returns a
 * different shape and we normalize that inline in the component.
 */
export function parsePlaceResult(place: any): AddressResult | null {
  if (!place?.place_id || !place?.geometry?.location) return null;
  const loc = place.geometry.location;
  const lat = typeof loc.lat === "function" ? loc.lat() : loc.lat;
  const lng = typeof loc.lng === "function" ? loc.lng() : loc.lng;
  const result: Partial<AddressResult> = {
    placeId: place.place_id,
    formattedAddress: place.formatted_address ?? "",
    lat,
    lng,
    country: "",
  };
  for (const component of place.address_components ?? []) {
    for (const type of component.types) {
      const key = COMPONENT_LOOKUPS[type];
      if (key && !result[key]) {
        // Use short_name for state (e.g. NSW) and country (e.g. AU)
        if (type === "administrative_area_level_1" || type === "country") {
          (result as any)[key] = component.short_name;
        } else {
          (result as any)[key] = component.long_name;
        }
      }
    }
  }
  if (!result.country) result.country = "AU"; // sensible default
  return result as AddressResult;
}

/**
 * Normalize a Place returned by the new `PlaceAutocompleteElement`
 * `gmp-placeselect` event (after calling `place.fetchFields(...)`).
 */
export function parseNewPlace(place: any): AddressResult | null {
  if (!place?.id) return null;
  const NEW_COMPONENT_LOOKUPS: Record<string, keyof AddressResult> = {
    subpremise: "unit",
    street_number: "streetNumber",
    route: "route",
    locality: "suburb",
    postal_town: "suburb",
    sublocality_level_1: "suburb",
    administrative_area_level_1: "state",
    postal_code: "postcode",
    country: "country",
  };
  const loc = place.location;
  const lat =
    typeof loc?.lat === "function" ? loc.lat() : typeof loc?.lat === "number" ? loc.lat : 0;
  const lng =
    typeof loc?.lng === "function" ? loc.lng() : typeof loc?.lng === "number" ? loc.lng : 0;
  const result: Partial<AddressResult> = {
    placeId: place.id,
    formattedAddress: place.formattedAddress ?? "",
    lat,
    lng,
    country: "",
  };
  for (const c of place.addressComponents ?? []) {
    for (const t of c.types ?? []) {
      const key = NEW_COMPONENT_LOOKUPS[t];
      if (key && !result[key]) {
        if (t === "administrative_area_level_1" || t === "country") {
          (result as any)[key] = c.shortText ?? c.short_name ?? "";
        } else {
          (result as any)[key] = c.longText ?? c.long_name ?? "";
        }
      }
    }
  }
  if (!result.country) result.country = "AU";
  return result as AddressResult;
}
