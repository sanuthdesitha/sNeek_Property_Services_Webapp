import { Role } from "@prisma/client";
import { db } from "@/lib/db";

export function extractLaundryTeamUserIds(accessInfo: unknown): string[] {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return [];
  const row = accessInfo as Record<string, unknown>;
  const values = Array.isArray(row.laundryTeamUserIds) ? row.laundryTeamUserIds : [];
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function propertyIsVisibleToLaundry(accessInfo: unknown, userId: string) {
  const ids = extractLaundryTeamUserIds(accessInfo);
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
