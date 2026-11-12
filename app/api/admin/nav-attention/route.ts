import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAdminAttentionCounts } from "@/lib/admin/attention-counts";
import { urgentStockOfficeAllowed } from "@/lib/inventory/urgent-stock";

// Live counts for the admin nav badges — polled by the portal shell.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // Urgent needs: administrators and operations managers whose inventory pack
    // allows reading them (the same rule as the tab and the service).
    const includeUrgentStock = await urgentStockOfficeAllowed(session.user, "read");
    const counts = await getAdminAttentionCounts(new Date(), { includeUrgentStock });
    return NextResponse.json({ counts });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
