import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { hubErrorResponse, readIssueHubQuery, readSort } from "@/lib/quality/http";
import { ISSUE_EXPORT_LIMIT, exportQualityIssues, qualityIssuesCsv } from "@/lib/quality/issue-list";
import { ISSUE_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/**
 * CSV of the QA issues matching the hub's period and filters (same parser as
 * the list). Refuses rather than truncating silently when the match is larger
 * than one export can hold.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    const params = req.nextUrl.searchParams;
    const { period, filters } = readIssueHubQuery(params);
    const { sort, dir } = readSort(params, ISSUE_SORTS, "created");
    const { rows, total, labelFor } = await exportQualityIssues(period, filters, sort, dir);
    if (total > ISSUE_EXPORT_LIMIT) {
      return NextResponse.json(
        { error: `${total} issues match. Narrow the period or filters to at most ${ISSUE_EXPORT_LIMIT} to export.` },
        { status: 400 },
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(qualityIssuesCsv(rows, labelFor), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="qa-issues-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return hubErrorResponse(error, "Could not export QA issues.");
  }
}
