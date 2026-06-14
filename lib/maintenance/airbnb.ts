import { JobType } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Maintenance/replacement tracking is scoped to Airbnb-style properties only.
 *
 * A property has no `isAirbnb` flag in the schema, so we treat a property as
 * "Airbnb" when EITHER:
 *  - it has at least one Job with jobType === AIRBNB_TURNOVER, OR
 *  - it has an iCal Integration (property.integration).
 *
 * The result is small and cheap to compute; callers may cache per-request.
 */
export async function isAirbnbProperty(propertyId: string): Promise<boolean> {
  if (!propertyId) return false;

  const [airbnbJob, integration] = await Promise.all([
    db.job.findFirst({
      where: { propertyId, jobType: JobType.AIRBNB_TURNOVER },
      select: { id: true },
    }),
    db.integration.findUnique({
      where: { propertyId },
      select: { id: true },
    }),
  ]);

  return Boolean(airbnbJob) || Boolean(integration);
}

/**
 * Batch variant: returns the set of propertyIds (from the supplied list) that
 * qualify as Airbnb. Used by list/summary screens that span many properties so
 * we avoid an N+1 of single lookups.
 */
export async function filterAirbnbPropertyIds(propertyIds: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(propertyIds.filter(Boolean)));
  if (unique.length === 0) return new Set();

  const [airbnbJobs, integrations] = await Promise.all([
    db.job.findMany({
      where: { propertyId: { in: unique }, jobType: JobType.AIRBNB_TURNOVER },
      select: { propertyId: true },
      distinct: ["propertyId"],
    }),
    db.integration.findMany({
      where: { propertyId: { in: unique } },
      select: { propertyId: true },
    }),
  ]);

  const set = new Set<string>();
  for (const j of airbnbJobs) set.add(j.propertyId);
  for (const i of integrations) set.add(i.propertyId);
  return set;
}

/**
 * Returns every Airbnb property id for a given client (used to scope the client
 * portal maintenance views).
 */
export async function airbnbPropertyIdsForClient(clientId: string): Promise<string[]> {
  if (!clientId) return [];
  const properties = await db.property.findMany({
    where: { clientId },
    select: { id: true },
  });
  const airbnb = await filterAirbnbPropertyIds(properties.map((p) => p.id));
  return Array.from(airbnb);
}
