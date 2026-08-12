import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { listJobsAwaitingQuickScore } from "@/lib/qa/auto-score";

// Submitted jobs with NO real QA inspection, each carrying a suggested score
// derived from the cleaner's own submission, so an admin can bulk-approve.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();

    const olderThanParam = req.nextUrl.searchParams.get("olderThanHours");
    const olderThanHours =
      olderThanParam && Number.isFinite(Number(olderThanParam))
        ? Math.max(0, Number(olderThanParam))
        : undefined;

    const jobs = await listJobsAwaitingQuickScore({ olderThanHours, limit: 200 });

    return NextResponse.json({
      jobs,
      threshold: settings.qaAutomation.failureThreshold,
      autoScore: {
        enabled: settings.qaAutomation.autoScoreEnabled,
        afterHours: settings.qaAutomation.autoScoreAfterHours,
      },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
