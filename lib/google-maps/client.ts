"use client";

import { Loader } from "@googlemaps/js-api-loader";
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
      "HTTP-referrer restrictions, billing, and that Places API + Maps JavaScript API are enabled.";
  };
}

function getLoader(): Promise<any> {
  if (loaderPromise) return loaderPromise;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error(
        "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set in the browser environment. " +
          "Confirm the key is in .env and that the dev server was restarted after adding it."
      )
    );
  }
  const loader = new Loader({
    apiKey,
    version: "weekly",
    libraries: ["places"],
  });
  loaderPromise = loader.load();
  return loaderPromise;
}

export async function loadPlacesLibrary(): Promise<any> {
  const g = await getLoader();
  // Give Google a tick to fire gm_authFailure if the key is bad
  await new Promise((r) => setTimeout(r, 50));
  if (runtimeAuthError) throw new Error(runtimeAuthError);
  if (!g?.maps?.places) {
    throw new Error(
      "Places library missing from Google Maps SDK. Enable the Places API (legacy) in the Google Cloud Console."
    );
  }
  return g.maps.places;
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
