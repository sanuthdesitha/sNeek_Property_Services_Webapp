"use client";

import { loadMapsLibrary } from "./client";

export type TravelMode = "DRIVING" | "TRANSIT" | "WALKING" | "BICYCLING";

export interface DistanceMatrixLeg {
  originIndex: number;
  destinationIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  status: string;
}

/**
 * Wraps google.maps.DistanceMatrixService.
 * Returns a flat list of leg entries for every (origin, destination) pair.
 */
export async function getDistanceMatrix(
  origins: Array<{ lat: number; lng: number }>,
  destinations: Array<{ lat: number; lng: number }>,
  mode: TravelMode = "DRIVING"
): Promise<DistanceMatrixLeg[]> {
  if (origins.length === 0 || destinations.length === 0) return [];
  await loadMapsLibrary();
  // DistanceMatrixService lives on `google.maps` directly even when using
  // importLibrary — load the routes library to ensure it's available.
  const g: any = (window as any).google;
  if (g?.maps?.importLibrary) {
    await g.maps.importLibrary("routes").catch(() => null);
  }
  const ServiceCtor = g?.maps?.DistanceMatrixService;
  if (!ServiceCtor) {
    throw new Error(
      "google.maps.DistanceMatrixService not available. Ensure the Distance Matrix API is enabled in the Google Cloud Console."
    );
  }
  const service = new ServiceCtor();

  const response: any = await new Promise((resolve, reject) => {
    service.getDistanceMatrix(
      {
        origins: origins.map((o) => ({ lat: o.lat, lng: o.lng })),
        destinations: destinations.map((d) => ({ lat: d.lat, lng: d.lng })),
        travelMode: g.maps.TravelMode[mode],
        unitSystem: g.maps.UnitSystem.METRIC,
        avoidHighways: false,
        avoidTolls: false,
      },
      (res: any, status: string) => {
        if (status === "OK" && res) resolve(res);
        else reject(new Error(`DistanceMatrix failed: ${status}`));
      }
    );
  });

  const legs: DistanceMatrixLeg[] = [];
  const rows = response.rows ?? [];
  for (let i = 0; i < rows.length; i++) {
    const elements = rows[i].elements ?? [];
    for (let j = 0; j < elements.length; j++) {
      const el = elements[j];
      legs.push({
        originIndex: i,
        destinationIndex: j,
        distanceMeters: el?.distance?.value ?? 0,
        durationSeconds: el?.duration?.value ?? 0,
        status: el?.status ?? "UNKNOWN",
      });
    }
  }
  return legs;
}

/**
 * Sequential route: leg[i] is the trip from waypoints[i] to waypoints[i+1].
 */
export async function getSequentialRoute(
  waypoints: Array<{ lat: number; lng: number }>,
  mode: TravelMode = "DRIVING"
): Promise<DistanceMatrixLeg[]> {
  if (waypoints.length < 2) return [];
  const legs: DistanceMatrixLeg[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    try {
      const slice = await getDistanceMatrix([waypoints[i]], [waypoints[i + 1]], mode);
      if (slice[0]) {
        legs.push({ ...slice[0], originIndex: i, destinationIndex: i + 1 });
      }
    } catch (err) {
      // Push a zero-leg entry so indices align; UI can render "—".
      legs.push({
        originIndex: i,
        destinationIndex: i + 1,
        distanceMeters: 0,
        durationSeconds: 0,
        status: "ERROR",
      });
    }
  }
  return legs;
}

export function formatDistance(meters: number): string {
  if (!meters || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}
