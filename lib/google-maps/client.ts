"use client";

import { Loader } from "@googlemaps/js-api-loader";
import type { AddressResult } from "./types";

let loaderPromise: Promise<typeof google> | null = null;

function getLoader(): Promise<typeof google> {
  if (loaderPromise) return loaderPromise;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured"));
  }
  const loader = new Loader({
    apiKey,
    version: "weekly",
    libraries: ["places"],
  });
  loaderPromise = loader.load();
  return loaderPromise;
}

export async function loadPlacesLibrary(): Promise<typeof google.maps.places> {
  const g = await getLoader();
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

export function parsePlaceResult(place: google.maps.places.PlaceResult): AddressResult | null {
  if (!place.place_id || !place.geometry?.location) return null;
  const result: Partial<AddressResult> = {
    placeId: place.place_id,
    formattedAddress: place.formatted_address ?? "",
    lat: place.geometry.location.lat(),
    lng: place.geometry.location.lng(),
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
