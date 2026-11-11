import { NextRequest, NextResponse } from "next/server";
import {
  Role,
  QaIssueSeverity,
  RectificationStatus,
  FalseConfirmationStatus,
  Prisma,
} from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ISSUE_ROW_INCLUDE, toIssueRows } from "@/lib/quality/issue-rows";
import { sydneyCreatedAtFilter } from "@/lib/quality/period";

/**
 * QA issue register — list endpoint (accountability Phase 5b). The v2 admin
 * now reads the Quality hub's paged list (/api/admin/quality/issues); this
 * route keeps its shape for the classic admin workspace. Read-only; every mutation goes through
 * /api/admin/qa/issues/[id]. ADMIN + OPS_MANAGER get full access; QA_INSPECTOR
 * may read (the workspace hides mutating actions for them).
 *
 * Filters (all optional, via query string): cleanerId, propertyId, category,
 * severity, rectificationStatus, falseConfirmation, from, to (createdAt range,
 * inclusive Australia/Sydney calendar days — `sydneyCreatedAtFilter`).
 * Paginated with take/skip (default take 50), ordered createdAt desc.
 *
 * The pay adjustment referenced by QaIssue.payAdjustmentId has no Prisma
 * relation, so it is resolved in a second query and stitched on.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);

    const { searchParams } = new URL(req.url);

    const cleanerId = searchParams.get("cleanerId") || undefined;
    const propertyId = searchParams.get("propertyId") || undefined;
    const category = searchParams.get("category") || undefined;
    const severityRaw = searchParams.get("severity") || undefined;
    const rectificationRaw = searchParams.get("rectificationStatus") || undefined;
    const falseConfRaw = searchParams.get("falseConfirmation") || undefined;
    const fromRaw = searchParams.get("from") || undefined;
    const toRaw = searchParams.get("to") || undefined;

    const takeRaw = Number(searchParams.get("take"));
    const skipRaw = Number(searchParams.get("skip"));
    const take = Number.isFinite(takeRaw) && takeRaw > 0 ? Math.min(takeRaw, 200) : 50;
    const skip = Number.isFinite(skipRaw) && skipRaw > 0 ? skipRaw : 0;

    // Coerce enum-typed filters, ignoring unknown values rather than 400ing.
    const severity =
      severityRaw && (Object.values(QaIssueSeverity) as string[]).includes(severityRaw)
        ? (severityRaw as QaIssueSeverity)
        : undefined;
    const rectificationStatus =
      rectificationRaw && (Object.values(RectificationStatus) as string[]).includes(rectificationRaw)
        ? (rectificationRaw as RectificationStatus)
        : undefined;
    const falseConfirmation =
      falseConfRaw && (Object.values(FalseConfirmationStatus) as string[]).includes(falseConfRaw)
        ? (falseConfRaw as FalseConfirmationStatus)
        : undefined;

    // Sydney calendar days, inclusive, the same days the Quality hub means.
    const createdAt: Prisma.DateTimeFilter | undefined = sydneyCreatedAtFilter(fromRaw, toRaw);

    const where: Prisma.QaIssueWhereInput = {
      ...(cleanerId ? { cleanerId } : {}),
      ...(propertyId ? { propertyId } : {}),
      ...(category ? { category } : {}),
      ...(severity ? { severity } : {}),
      ...(rectificationStatus ? { rectificationStatus } : {}),
      ...(falseConfirmation ? { falseConfirmation } : {}),
      ...(createdAt ? { createdAt } : {}),
    };

    const [total, issues] = await Promise.all([
      db.qaIssue.count({ where }),
      db.qaIssue.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: ISSUE_ROW_INCLUDE,
      }),
    ]);

    // Same row shape as before, now built by the helper the Quality hub's
    // paged list also uses (it stitches on the linked pay adjustment).
    const rows = await toIssueRows(issues);

    return NextResponse.json({
      issues: rows,
      pagination: { total, take, skip, hasMore: skip + rows.length < total },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    // Internal failures are not echoed to the browser.
    return NextResponse.json({ error: status === 500 ? "Failed to load QA issues." : err.message }, { status });
  }
}
