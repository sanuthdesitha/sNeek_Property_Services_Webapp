import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { loadPropertyOverview } from "@/lib/properties/overview";

/**
 * GET — the property page's Overview read model ("Coming up" and the rail
 * summaries). ADMIN / OPS_MANAGER, as the rest of the property page. What the
 * client owes is included only for ADMIN or an operations manager with the
 * finance feature; otherwise it is left out here, not hidden in the browser.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const levels = await getOpsAccess(session.user);
    const showMoney = levels === null || opsLevelAllows(levels.finance, "GET");
    const overview = await loadPropertyOverview(params.id, { showMoney });
    if (!overview) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    return NextResponse.json(overview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the overview.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the overview." : message }, { status });
  }
}
