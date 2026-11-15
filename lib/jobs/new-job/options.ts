import "server-only";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import type { NewJobOptions, NewJobPropertyOption } from "./types";

/**
 * The property picker of the New job page: every property (inactive ones are
 * listed and marked, as drawn), the latest job day at each, and the
 * properties of the most recently created jobs as "Recent". Read only.
 */
function isServiceSite(accessInfo: unknown): boolean {
  return Boolean(accessInfo && typeof accessInfo === "object" && (accessInfo as { serviceSite?: unknown }).serviceSite === true);
}

export async function loadNewJobOptions(): Promise<NewJobOptions> {
  const [properties, lastJobs, recentJobs, settings] = await Promise.all([
    db.property.findMany({
      select: { id: true, name: true, address: true, suburb: true, isActive: true, accessInfo: true, client: { select: { name: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.job.groupBy({ by: ["propertyId"], _max: { scheduledDate: true } }),
    db.job.findMany({ orderBy: { createdAt: "desc" }, take: 40, select: { propertyId: true } }),
    getAppSettings(),
  ]);
  const lastByProperty = new Map(lastJobs.map((row) => [row.propertyId, row._max.scheduledDate]));
  const rows: NewJobPropertyOption[] = properties.map((property) => {
    const last = lastByProperty.get(property.id) ?? null;
    return {
      id: property.id,
      name: property.name,
      address: property.address,
      suburb: property.suburb,
      clientName: property.client?.name ?? null,
      isActive: property.isActive,
      isOneOff: isServiceSite(property.accessInfo),
      lastJobDayKey: last ? last.toISOString().slice(0, 10) : null,
    };
  });
  const known = new Set(rows.filter((row) => row.isActive && !row.isOneOff).map((row) => row.id));
  const recent: string[] = [];
  for (const job of recentJobs) {
    if (known.has(job.propertyId) && !recent.includes(job.propertyId)) recent.push(job.propertyId);
    if (recent.length === 3) break;
  }
  return {
    properties: rows,
    recentPropertyIds: recent,
    recurring: { enabled: settings.recurringJobs.enabled, lookaheadDays: settings.recurringJobs.lookaheadDays },
  };
}
