import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EMPTY_QUALITY_FILTERS } from "@/lib/quality/types";
import { getInspectorRows, sortInspectorRows } from "@/lib/quality/inspectors";
import { legacyAccountabilityPeriod } from "@/lib/quality/legacy";

export const dynamic = "force-dynamic";

/**
 * QA-PERFORMANCE (ADMIN / OPS_MANAGER) — kept for the classic admin dashboard.
 *
 * A thin caller of the Quality hub's inspector grouping (lib/quality/inspectors),
 * so the classic page and the hub's Inspectors tab report the same figures.
 * ?period=7d|30d|90d (default 30d; anything else reads as 30d, as before), now
 * measured in Sydney calendar days by the shared period helper.
 */
export async function GET(req: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const period = legacyAccountabilityPeriod(new URL(req.url).searchParams.get("period"));
    const result = await getInspectorRows(period, EMPTY_QUALITY_FILTERS, "issues", "desc");
    // The classic dashboard's order: most issues found, then most inspections.
    const inspectors = sortInspectorRows(result.rows, "inspections", "desc").sort(
      (a, b) => b.issuesFound.total - a.issuesFound.total,
    );
    return NextResponse.json({
      period: period.key,
      windowStart: period.start?.toISOString() ?? null,
      generatedAt: new Date().toISOString(),
      note: result.note,
      inspectors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message || "Could not load QA performance." }, { status });
  }
}
