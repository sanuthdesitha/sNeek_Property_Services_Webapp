import type { Prisma } from "@prisma/client";

/**
 * Which maintenance items a portal viewer may list.
 *
 * A maintenance worker is often an outside contractor. They see the jobs
 * assigned to them and nothing else: not other workers' jobs, and not the
 * business-wide queue. Office roles see everything. Every list, count and
 * detail read in the maintenance portal must apply this filter.
 */
export function maintenanceItemScope(viewer: {
  id: string;
  role: string;
}): Prisma.PropertyMaintenanceItemWhereInput {
  if (viewer.role === "ADMIN" || viewer.role === "OPS_MANAGER") return {};
  if (viewer.role === "MAINTENANCE") return { assignedWorker: { userId: viewer.id } };
  // Any other role reaching a maintenance-portal query sees nothing.
  return { id: { in: [] } };
}
