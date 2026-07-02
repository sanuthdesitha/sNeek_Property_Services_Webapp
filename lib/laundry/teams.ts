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

/**
 * All property IDs a laundry user is allowed to see (laundry-enabled AND either
 * on the property's team or the property has no team). Used to scope laundry
 * invoice/report exports so a laundry user can't pull another team's financials.
 */
export async function getVisibleLaundryPropertyIds(userId: string): Promise<string[]> {
  const properties = await db.property.findMany({
    where: { NOT: { laundryEnabled: false } },
    select: { id: true, accessInfo: true, laundryEnabled: true },
  });
  return properties.filter((p) => propertyIsVisibleToLaundry(p, userId)).map((p) => p.id);
}

/**
 * Enforce laundry-team scoping on an invoice/report request. ADMIN/OPS are
 * unrestricted. For a LAUNDRY user: a specific task/property must be visible to
 * them (else ok:false → 403), and an unscoped/multi-property request is narrowed
 * to only the properties they can see. Returns a propertyIds override to apply
 * to the query when narrowing is needed.
 */
export async function resolveLaundryInvoiceScope(
  role: Role,
  userId: string,
  scope: { taskId?: string; propertyId?: string; propertyIds?: string[] }
): Promise<{ ok: true; propertyIds?: string[] } | { ok: false }> {
  if (role !== Role.LAUNDRY) return { ok: true };
  const visible = new Set(await getVisibleLaundryPropertyIds(userId));

  if (scope.taskId) {
    const task = await db.laundryTask.findUnique({
      where: { id: scope.taskId },
      select: { propertyId: true },
    });
    if (!task || !visible.has(task.propertyId)) return { ok: false };
    return { ok: true };
  }
  if (scope.propertyId) {
    return visible.has(scope.propertyId) ? { ok: true } : { ok: false };
  }
  // Unscoped or multi-property: force the query to the visible set (intersecting
  // with any explicitly requested propertyIds).
  const requested = scope.propertyIds?.length
    ? scope.propertyIds.filter((id) => visible.has(id))
    : Array.from(visible);
  return { ok: true, propertyIds: requested };
}
