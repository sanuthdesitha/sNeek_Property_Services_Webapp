import "server-only";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { liveAccessFor, type LiveAccess } from "./live-access";

/**
 * The live session and role guard for every Live ops route, plus the pack
 * filter (lib/ops/live-access). Throws "FORBIDDEN" when the Dashboard pack is
 * off, even if middleware let the request through.
 */
export async function requireLiveViewer(): Promise<{ userId: string; access: LiveAccess }> {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const levels = await getOpsAccess(session.user);
  const access = liveAccessFor(levels);
  if (!access.live) throw new Error("FORBIDDEN");
  return { userId: session.user.id, access };
}

export function liveErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  return message === "UNAUTHORIZED" ? 401 : 403;
}
