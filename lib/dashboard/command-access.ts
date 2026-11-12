import "server-only";
/**
 * Server side of Command: who is viewing (live session and role guard, ops
 * packs re-read on every request) and the per-section loader used by both the
 * page's first render and GET /api/admin/command/[section].
 */
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import type { CommandViewer } from "./command-viewer";
import type { CommandSectionKey } from "./command-types";
import { commandTimeZone, loadCommandTiles, loadTodayByCleaner } from "./command-sections";
import { loadCommandMoney, viewerSeesMoney } from "./command-money";
import { loadCommandGlance } from "./command-glance";
import { buildWorkQueue } from "./work-queue";

export const COMMAND_SECTIONS: readonly CommandSectionKey[] = ["tiles", "queue", "cleaners", "money", "glance"];

export function isCommandSection(value: string): value is CommandSectionKey {
  return (COMMAND_SECTIONS as readonly string[]).includes(value);
}

export async function requireCommandViewer(): Promise<CommandViewer> {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const levels = await getOpsAccess(session.user);
  return { levels, readOnly: session.impersonation?.mode === "READ_ONLY" };
}

export class SectionForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
  }
}

export async function loadCommandSection(key: CommandSectionKey, viewer: CommandViewer, now = new Date()): Promise<unknown> {
  const timeZone = await commandTimeZone();
  switch (key) {
    case "tiles":
      return loadCommandTiles(viewer, now, timeZone);
    case "queue":
      return buildWorkQueue(viewer, { now, timeZone });
    case "cleaners":
      return loadTodayByCleaner(now, timeZone);
    case "money":
      if (!viewerSeesMoney(viewer)) throw new SectionForbiddenError();
      return loadCommandMoney(viewer, now, timeZone);
    case "glance":
      return loadCommandGlance(now, timeZone);
  }
}
