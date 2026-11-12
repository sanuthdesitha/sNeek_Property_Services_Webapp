import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { isDayKey } from "@/lib/calendar/range";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { loadLaundryPipeline } from "@/lib/laundry/pipeline-server";

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * GET /api/admin/laundry/pipeline?date=YYYY-MM-DD&q&supplierId&driverId
 * The Pipeline lanes for one Sydney day with real lane counts (after filters),
 * the day's unfiltered summary, today's stat figures and the Approvals count.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = new URL(req.url).searchParams;
    const date = params.get("date") ?? sydneyTodayKey();
    if (!isDayKey(date)) return NextResponse.json({ error: "date must be a YYYY-MM-DD day." }, { status: 400 });
    const supplierId = params.get("supplierId") || null;
    const driverId = params.get("driverId") || null;
    if ((supplierId && !ID.test(supplierId)) || (driverId && !ID.test(driverId))) {
      return NextResponse.json({ error: "Invalid filter." }, { status: 400 });
    }
    const pipeline = await loadLaundryPipeline(
      date,
      { q: (params.get("q") ?? "").slice(0, 120), supplierId, driverId },
      { role: session.user.role, userId: session.user.id },
    );
    return NextResponse.json(pipeline);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not load the pipeline.";
    return NextResponse.json({ error: message }, { status: getApiErrorStatus(err) });
  }
}
