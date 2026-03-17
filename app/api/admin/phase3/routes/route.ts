import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";
import { resolveBranchPropertyIds } from "@/lib/phase3/branches";

const querySchema = z.object({
  date: z.string().date(),
  branchId: z.string().trim().optional(),
});

function makeMapsSearchUrl(address: string) {
  const q = address.trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function makeMapsDirectionsUrl(addresses: string[]) {
  const clean = addresses.map((value) => value.trim()).filter(Boolean);
  if (clean.length < 2) return clean[0] ? makeMapsSearchUrl(clean[0]) : null;
  const origin = clean[0];
  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(1, -1).slice(0, 8);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving",
  });
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const { date, branchId } = querySchema.parse({
      date: searchParams.get("date") ?? new Date().toISOString().slice(0, 10),
      branchId: searchParams.get("branchId") ?? undefined,
    });

    const propertyIds = await resolveBranchPropertyIds(branchId ?? null);
    const routes = await buildDailyRoutePlan(date, {
      propertyIds: Array.isArray(propertyIds) ? propertyIds : undefined,
    });

    const enriched = routes.map((route) => {
      const stops = route.stops.map((stop) => ({
        ...stop,
        mapsUrl: makeMapsSearchUrl(stop.address),
      }));
      const addresses = stops.map((stop) => stop.address);
      const clustersBySuburb = new Map<
        string,
        {
          suburb: string;
          stopCount: number;
          stops: Array<{ jobId: string; propertyName: string; address: string; mapsUrl: string | null }>;
        }
      >();
      for (const stop of stops) {
        const key = stop.suburb || "Unknown";
        if (!clustersBySuburb.has(key)) {
          clustersBySuburb.set(key, {
            suburb: key,
            stopCount: 0,
            stops: [],
          });
        }
        const cluster = clustersBySuburb.get(key)!;
        cluster.stopCount += 1;
        cluster.stops.push({
          jobId: stop.jobId,
          propertyName: stop.propertyName,
          address: stop.address,
          mapsUrl: stop.mapsUrl,
        });
      }
      return {
        ...route,
        stops,
        routeMapUrl: makeMapsDirectionsUrl(addresses),
        suburbClusters: Array.from(clustersBySuburb.values()).sort((a, b) =>
          a.suburb.localeCompare(b.suburb)
        ),
      };
    });

    return NextResponse.json({ date, branchId: branchId ?? null, routes: enriched });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err.message ?? "Could not build phase 3 route clusters." },
      { status }
    );
  }
}

