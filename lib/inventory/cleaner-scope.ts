/**
 * Which properties a CLEANER may see supplies for.
 *
 * Four surfaces answered this question four different ways:
 *   · restock            assigned + inventory-enabled — but NOT filtered on
 *                        `isActive`, so retired properties kept appearing.
 *   · shopping-plan      every active inventory-enabled property, with no
 *                        assignment filter at all.
 *   · stock-runs         same — the cleaner branch fell through to a global
 *                        query identical to the admin one.
 *   · the supplies page  its own on-hand query.
 *
 * The answer is one thing: **active AND assigned**. A cleaner needs stock for
 * the properties they actually work at; a global list is both a privacy
 * problem (it enumerates the whole client base) and a usability one — the
 * supplies screen was reported unusable precisely because it listed
 * everything.
 *
 * `inventoryEnabled` is deliberately NOT part of this predicate. It is an
 * opt-OUT for properties that do not track stock, and the wave-3 data
 * migration turns it on for every active property; callers that genuinely
 * need the flag can still ask for it.
 */
import { db } from "@/lib/db";

export interface CleanerAccessibleProperty {
  id: string;
  name: string;
  suburb: string | null;
  clientId: string | null;
}

/** The `Property.where` clause for "active and assigned to this cleaner". */
export function accessiblePropertyWhereForCleaner(userId: string) {
  return {
    isActive: true,
    jobs: { some: { assignments: { some: { userId, removedAt: null } } } },
  };
}

/**
 * Properties this cleaner works at, name-ordered.
 *
 * Queried from Property (not from Job) so the shape matches the admin/client
 * branches of the same callers and de-duplication is the database's job.
 */
export async function accessiblePropertiesForCleaner(
  userId: string,
  options: { inventoryEnabledOnly?: boolean } = {}
): Promise<CleanerAccessibleProperty[]> {
  return db.property.findMany({
    where: {
      ...accessiblePropertyWhereForCleaner(userId),
      ...(options.inventoryEnabledOnly ? { inventoryEnabled: true } : {}),
    },
    select: { id: true, name: true, suburb: true, clientId: true },
    orderBy: [{ name: "asc" }],
  });
}
