/**
 * Returns estimated driving time in minutes.
 * Origin can be lat/lng coordinates, destination can be lat/lng or an address string.
 * Uses Google Maps Distance Matrix API (server-side).
 * Returns null on failure or if the API key is not configured.
 */
export async function getEtaMinutes(input: {
  fromLat: number;
  fromLng: number;
  toLat?: number | null;
  toLng?: number | null;
  toAddress?: string | null;
}): Promise<number | null> {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;

  const destination =
    input.toLat != null && input.toLng != null
      ? `${input.toLat},${input.toLng}`
      : input.toAddress?.trim() || null;

  if (!destination) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", `${input.fromLat},${input.fromLng}`);
    url.searchParams.set("destinations", destination);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json();
    const element = data?.rows?.[0]?.elements?.[0];
    if (element?.status !== "OK") return null;

    return Math.ceil((element.duration?.value ?? 0) / 60);
  } catch {
    return null;
  }
}

/**
 * Geocode a property address to lat/lng using the Distance Matrix API response.
 * Only works if the Geocoding API is enabled. Falls back to null.
 */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", address);
    url.searchParams.set("region", "au");
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK") return null;
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc?.lat || !loc?.lng) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}
