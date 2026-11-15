import "server-only";
import { db } from "@/lib/db";
import { heldRoles } from "@/lib/auth/roles";
import { getOpsAccess } from "./ops-access";
import type { OpsNavigationSeed } from "./ops-navigation-seed-types";

/**
 * The rail's first answer, resolved on the server for the signed-in person.
 * Returns null (the browser then waits for /api/me/ops-permissions, as before)
 * when nobody is signed in, during "test as" (the browser session does not
 * know the target), inside a retained-account context, for an inactive
 * account, or when the read fails. Navigation only: every route still checks
 * the live policy itself.
 */
export async function opsNavigationSeed(input: {
  userId: string | null | undefined;
  impersonating: boolean;
  retainedContext: boolean;
}): Promise<OpsNavigationSeed | null> {
  if (!input.userId || input.impersonating || input.retainedContext) return null;
  try {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { id: true, isActive: true, role: true, extraRoles: { select: { role: true } } },
    });
    if (!user?.isActive) return null;
    const held = heldRoles(user.role, user.extraRoles.map((row) => row.role));
    const levels = await getOpsAccess({ id: user.id, role: user.role, heldRoles: held });
    return { userId: user.id, role: user.role, levels };
  } catch {
    return null;
  }
}
