import { format, isMatch } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getServerMapsKey } from "@/lib/maps/server-key";
import { RouteMapWorkspace } from "@/components/v2/admin/jobs/route-map/route-map-workspace";

export const metadata = { title: "Route map · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

function sydneyDay(offsetDays: number): string {
  const zoned = toZonedTime(new Date(), TZ);
  return format(new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate() + offsetDays), "yyyy-MM-dd");
}

function resolveDate(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && isMatch(candidate, "yyyy-MM-dd") ? candidate : sydneyDay(0);
}

/**
 * Route map (board "Route map", 2026-11-17): the day's routes beside a map.
 * ADMIN and OPS_MANAGER, as before. The day is read by the workspace from
 * `GET /api/admin/jobs/route-map` (cancellable per date); this page only
 * resolves the date and whether a Maps key is configured (never the key).
 */
export default async function V2RouteMapPage({ searchParams }: { searchParams?: { date?: string | string[] } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const date = resolveDate(searchParams?.date);
  const mapConfigured = Boolean(await getServerMapsKey());
  return <RouteMapWorkspace date={date} today={sydneyDay(0)} tomorrow={sydneyDay(1)} mapConfigured={mapConfigured} />;
}
