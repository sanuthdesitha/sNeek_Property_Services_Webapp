/**
 * Who may use the office side of urgent stock (Wave F, owner decision seven:
 * operations managers see and act on urgent stock with their inventory pack).
 *
 * - ADMIN: always, independently of operations packs.
 * - OPS_MANAGER: the "inventory" feature of their pack: "read" to see the
 *   list, the badge and a need's history; "manage" for every write (report,
 *   stage actions, add to a shopping run, ask a cleaner to buy).
 * - Everyone else: refused (cleaners keep their own job-scoped path).
 *
 * The role is re-read from the database by the caller (revoked roles lose
 * access at once); the pack is read from the live operations policy.
 *
 * Owner decision 2026-11-12: Resolve (closing a need without a property
 * confirmation), bulk Close and the reminder settings are no longer
 * ADMIN-only: they need "manage", like every other office write. The
 * callers (actOnUrgentStock, setUrgentStockSettings) re-check it.
 */
import { Role } from "@prisma/client";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import type { OpsLevel } from "@/lib/rbac/ops-catalog";

export type UrgentOfficeLevel = "read" | "manage";

/** Pure: does an inventory level allow this office use? */
export function inventoryLevelAllows(level: OpsLevel | null, wanted: UrgentOfficeLevel): boolean {
  // null: not an operations-pack subject (no pack restriction applies).
  if (level === null) return true;
  if (wanted === "read") return level === "read" || level === "manage";
  return level === "manage";
}

/**
 * Office access for an actor whose acting role and held roles were just read
 * from the database. Never trusts a client-supplied role list.
 */
export async function urgentOfficeAllowed(
  actor: { id: string; role: Role },
  heldRoles: Role[],
  wanted: UrgentOfficeLevel,
): Promise<boolean> {
  if (actor.role === Role.ADMIN) return true;
  if (actor.role !== Role.OPS_MANAGER) return false;
  const levels = await getOpsAccess({ id: actor.id, role: actor.role, heldRoles });
  return inventoryLevelAllows(levels ? levels.inventory : null, wanted);
}
