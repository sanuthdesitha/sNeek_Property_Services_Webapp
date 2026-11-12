import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { listJobsAwaitingQuickScore } from "@/lib/qa/auto-score";
import { parseQualityFiltersLenient } from "@/lib/quality/filters";
import { queueJobNarrow } from "@/lib/quality/where";

// Submitted jobs with NO real QA inspection, each carrying a suggested score
// derived from the cleaner's own submission, so an admin can bulk-approve.
// Optional Quality hub narrowing: ?propertyId= and ?q= (property, job number or
// cleaner name). Narrowing can only remove jobs from the list.
export const dynamic = "force-dynamic";

const AWAITING_LIMIT = 200;

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();

    const olderThanParam = req.nextUrl.searchParams.get("olderThanHours");
    const olderThanHours =
      olderThanParam && Number.isFinite(Number(olderThanParam))
        ? Math.max(0, Number(olderThanParam))
        : undefined;

    const narrow = queueJobNarrow(parseQualityFiltersLenient(req.nextUrl.searchParams));
    const jobs = await listJobsAwaitingQuickScore({ olderThanHours, limit: AWAITING_LIMIT, narrow });

    return NextResponse.json({
      jobs,
      limit: AWAITING_LIMIT,
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
