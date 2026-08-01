import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Share / unshare a QA report with the cleaner it concerns.
 *
 * Mirrors the job report's visibility switch
 * (app/api/admin/reports/[jobId]/visibility/route.ts). Default is SHARED — a
 * cleaner seeing what they were marked down for is the norm, and the QA report
 * route already permitted them before this flag existed. The toggle exists for
 * the occasional inspection an admin wants to withhold while a dispute is
 * being resolved.
 */
const bodySchema = z.object({ visible: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { visible } = bodySchema.parse(await req.json());

    const review = await db.qAReview.findUnique({
      where: { id: params.id },
      select: { id: true, jobId: true, cleanerReportVisible: true },
    });
    if (!review) {
      return NextResponse.json({ error: "QA review not found." }, { status: 404 });
    }

    const updated = await db.qAReview.update({
      where: { id: params.id },
      data: { cleanerReportVisible: visible },
      select: { id: true, cleanerReportVisible: true },
    });

    // Withholding a cleaner's own inspection result is a decision worth a trail.
    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: visible ? "QA_REPORT_SHARED_WITH_CLEANER" : "QA_REPORT_HIDDEN_FROM_CLEANER",
          entity: "QAReview",
          entityId: params.id,
          before: { cleanerReportVisible: review.cleanerReportVisible } as any,
          after: { cleanerReportVisible: visible } as any,
        },
      })
      .catch(() => undefined);

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update visibility." }, { status });
  }
}
