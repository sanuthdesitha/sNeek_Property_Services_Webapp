import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { opsLevelAllows } from "@/lib/rbac/ops-catalog";
import { RaiseIssueError, raiseQaIssueFromCase } from "@/lib/quality/raise-from-case";
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

/**
 * POST: raise a QA issue for a cleaner from a case (Cases → Next steps). ADMIN,
 * and OPS_MANAGER whose quality pack is at manage level (the same pack rule
 * the issue PATCH and the hub's actions follow); QA inspectors do not use this
 * route. Refused while impersonating, so `raisedById` is always the real
 * person. Creates a normal QaIssue and never a deduction; see
 * lib/quality/raise-from-case.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "QA issues cannot be raised while impersonating." }, { status: 403 });
    const levels = await getOpsAccess(session.user);
    if (levels && !opsLevelAllows(levels.quality, "POST")) {
      return NextResponse.json({ error: "Your quality permission is read-only." }, { status: 403 });
    }
    const result = await raiseQaIssueFromCase(session.user.id, await req.json());
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof RaiseIssueError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Check the cleaner, category, severity and description." }, { status: 400 });
    }
    return hubErrorResponse(error, "Could not raise the QA issue.");
  }
}
