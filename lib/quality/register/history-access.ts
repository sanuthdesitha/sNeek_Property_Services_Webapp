import "server-only";
/**
 * Whether the property and person pages offer "Issue history" (the register
 * pre-filtered): the pilot is on for this viewer and their packs reach the
 * register. The register route checks again on every read.
 */
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { canUseOpsPath } from "@/lib/rbac/ops-catalog";
import { isPilotOn } from "@/lib/pilots/state";
import { registerHistoryHref } from "./history";

type Viewer = { id: string; role: string; heldRoles?: string[] };

export async function issueHistoryHrefFor(viewer: Viewer, filter: { propertyId: string } | { cleanerId: string }): Promise<string | null> {
  if (viewer.role !== "ADMIN" && viewer.role !== "OPS_MANAGER") return null;
  if (!(await isPilotOn("issues-register", { userId: viewer.id }))) return null;
  const levels = await getOpsAccess(viewer);
  if (levels && !canUseOpsPath(levels, "/api/admin/quality/register")) return null;
  return registerHistoryHref(filter);
}
