/**
 * Who is looking at Command, reduced to what the sections need. Pure: the
 * server resolves the ops levels (lib/rbac/ops-access) and passes them in.
 *
 * ADMIN has `levels: null` (full feature rights, independent of ops packs).
 * An operations manager is limited by their packs; a read-only impersonation
 * sees what the target sees but can trigger nothing.
 */
import { canUseOpsPath, opsLevelAllows, type OpsFeature, type OpsLevels } from "@/lib/rbac/ops-catalog";

export type CommandViewer = {
  levels: OpsLevels | null;
  readOnly: boolean;
};

export const FULL_ACCESS_VIEWER: CommandViewer = { levels: null, readOnly: false };

/** May the viewer open this page (GET)? */
export function viewerCanOpen(viewer: CommandViewer, href: string): boolean {
  if (/^(mailto:|tel:)/.test(href)) return true;
  return !viewer.levels || canUseOpsPath(viewer.levels, href, "GET");
}

/** May the viewer call this endpoint with this method? */
export function viewerCanCall(viewer: CommandViewer, endpoint: string, method: string): boolean {
  if (viewer.readOnly) return false;
  return !viewer.levels || canUseOpsPath(viewer.levels, endpoint, method);
}

/** May the viewer read this feature at all? */
export function viewerHasFeature(viewer: CommandViewer, feature: OpsFeature): boolean {
  return !viewer.levels || opsLevelAllows(viewer.levels[feature], "GET");
}
