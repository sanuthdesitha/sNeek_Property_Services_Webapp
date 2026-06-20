import { Role } from "@prisma/client";
import { db } from "@/lib/db";

export function extractLaundryTeamUserIds(accessInfo: unknown): string[] {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return [];
  const row = accessInfo as Record<string, unknown>;
  const values = Array.isArray(row.laundryTeamUserIds) ? row.laundryTeamUserIds : [];
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

/**
 * Whether a laundry user may see a property's laundry. Two gates:
 *   1. The property must have laundry service ON (`laundryEnabled !== false`).
 *      A property created without laundry service is never shown to laundry.
 *   2. If a laundry team is assigned, the user must be on it; if none is
 *      assigned, all active laundry users can see it.
 */
export function propertyIsVisibleToLaundry(
  property: { accessInfo?: unknown; laundryEnabled?: boolean | null } | null | undefined,
  userId: string
) {
  if (!property) return false;
  if (property.laundryEnabled === false) return false;
  const ids = extractLaundryTeamUserIds(property.accessInfo);
  return ids.length === 0 || ids.includes(userId);
}

export async function getAssignedLaundryUsersForProperty(propertyId: string) {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { accessInfo: true },
  });
  if (!property) return [];

  const explicitIds = extractLaundryTeamUserIds(property.accessInfo);
  return db.user.findMany({
    where:
      explicitIds.length > 0
        ? { id: { in: explicitIds }, role: Role.LAUNDRY, isActive: true }
        : { role: Role.LAUNDRY, isActive: true },
    select: { id: true, name: true, email: true, phone: true, role: true },
    orderBy: { name: "asc" },
  });
}
