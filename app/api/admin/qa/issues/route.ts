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

/**
 * QA issue register — list endpoint powering the admin QA Issues workspace
 * (accountability Phase 5b). Read-only; every mutation goes through
 * /api/admin/qa/issues/[id]. ADMIN + OPS_MANAGER get full access; QA_INSPECTOR
 * may read (the workspace hides mutating actions for them).
 *
 * Filters (all optional, via query string): cleanerId, propertyId, category,
 * severity, rectificationStatus, falseConfirmation, from, to (createdAt range).
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

    let createdAt: Prisma.DateTimeFilter | undefined;
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
      createdAt = {};
      if (from && !Number.isNaN(from.getTime())) createdAt.gte = from;
      if (to && !Number.isNaN(to.getTime())) {
        // Inclusive of the whole `to` day.
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        createdAt.lte = end;
      }
    }

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
        include: {
          job: {
            select: {
              id: true,
              jobNumber: true,
              scheduledDate: true,
              property: { select: { id: true, name: true, suburb: true } },
            },
          },
          property: { select: { id: true, name: true, suburb: true } },
          cleaner: { select: { id: true, name: true, email: true } },
          raisedBy: { select: { id: true, name: true, email: true } },
          rectifiedBy: { select: { id: true, name: true } },
          qaReview: { select: { id: true, score: true, rating: true, managementReview: true } },
        },
      }),
    ]);

    // Resolve linked pay adjustments (no FK relation on QaIssue.payAdjustmentId).
    const payAdjustmentIds = Array.from(
      new Set(issues.map((i) => i.payAdjustmentId).filter((id): id is string => Boolean(id)))
    );
    const payAdjustments = payAdjustmentIds.length
      ? await db.cleanerPayAdjustment.findMany({
          where: { id: { in: payAdjustmentIds } },
          select: { id: true, status: true, requestedAmount: true, approvedAmount: true, source: true },
        })
      : [];
    const payMap = Object.fromEntries(payAdjustments.map((p) => [p.id, p]));

    const rows = issues.map((issue) => ({
      id: issue.id,
      category: issue.category,
      severity: issue.severity,
      description: issue.description,
      rectificationStatus: issue.rectificationStatus,
      rectificationMinutes: issue.rectificationMinutes,
      rectificationCost: issue.rectificationCost,
      rectificationBeforeKeys: issue.rectificationBeforeKeys ?? null,
      rectificationAfterKeys: issue.rectificationAfterKeys ?? null,
      falseConfirmation: issue.falseConfirmation,
      guestReadyImpact: issue.guestReadyImpact,
      cleanerMarkedComplete: issue.cleanerMarkedComplete,
      qaPhotoKeys: issue.qaPhotoKeys ?? null,
      escalatedAt: issue.escalatedAt,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      jobId: issue.jobId,
      propertyId: issue.propertyId,
      cleanerId: issue.cleanerId,
      job: issue.job
        ? {
            id: issue.job.id,
            jobNumber: issue.job.jobNumber,
            scheduledDate: issue.job.scheduledDate,
            propertyName: issue.job.property?.name ?? issue.property?.name ?? null,
            propertySuburb: issue.job.property?.suburb ?? issue.property?.suburb ?? null,
          }
        : null,
      property: issue.property
        ? { id: issue.property.id, name: issue.property.name, suburb: issue.property.suburb }
        : null,
      cleaner: issue.cleaner
        ? { id: issue.cleaner.id, name: issue.cleaner.name ?? issue.cleaner.email }
        : null,
      raisedBy: issue.raisedBy
        ? { id: issue.raisedBy.id, name: issue.raisedBy.name ?? issue.raisedBy.email }
        : null,
      rectifiedBy: issue.rectifiedBy ? { id: issue.rectifiedBy.id, name: issue.rectifiedBy.name } : null,
      review: issue.qaReview
        ? {
            id: issue.qaReview.id,
            score: issue.qaReview.score,
            rating: issue.qaReview.rating,
            managementReview: issue.qaReview.managementReview,
          }
        : null,
      payAdjustment: issue.payAdjustmentId
        ? (() => {
            const pa = payMap[issue.payAdjustmentId];
            return pa
              ? {
                  id: pa.id,
                  status: pa.status,
                  requestedAmount: pa.requestedAmount,
                  approvedAmount: pa.approvedAmount,
                  source: pa.source,
                }
              : { id: issue.payAdjustmentId, status: null, requestedAmount: null, approvedAmount: null, source: null };
          })()
        : null,
    }));

    return NextResponse.json({
      issues: rows,
      pagination: { total, take, skip, hasMore: skip + rows.length < total },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed to load QA issues." }, { status });
  }
}
