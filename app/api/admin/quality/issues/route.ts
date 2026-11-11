import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { parseListQuery } from "@/lib/admin/list-query";
import { hubErrorResponse, readIssueHubQuery } from "@/lib/quality/http";
import { listQualityIssues } from "@/lib/quality/issue-list";
import { ISSUE_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/**
 * Quality hub Issues tab: server-paged, server-sorted QA issues with the real
 * total for the period and filters. QA inspectors may read (the hub shows
 * them a read-only view); every change goes through the existing
 * PATCH /api/admin/qa/issues/[id] or the bulk route beside this one.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: ISSUE_SORTS, defaultSort: "created", defaultDir: "desc" });
    const { period, filters } = readIssueHubQuery(params);
    return NextResponse.json(await listQualityIssues(period, filters, query));
  } catch (error) {
    return hubErrorResponse(error, "Could not load QA issues.");
  }
}
