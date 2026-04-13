import { NextRequest, NextResponse } from "next/server";
import { PayAdjustmentStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { publicUrl } from "@/lib/s3";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const statusRaw = searchParams.get("status");
    const status = statusRaw && Object.values(PayAdjustmentStatus).includes(statusRaw as PayAdjustmentStatus)
      ? (statusRaw as PayAdjustmentStatus)
      : undefined;

    const rows = await db.cleanerPayAdjustment.findMany({
      where: status ? { status } : undefined,
      include: {
        cleaner: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        job: {
          select: {
            id: true,
            jobType: true,
            scheduledDate: true,
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
            clientId: true,
            client: { select: { email: true } },
          },
        },
      },
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
    });

    const approvals = await listClientApprovals();
    const approvalByAdjustmentId = new Map<string, (typeof approvals)[number]>();
    for (const approval of approvals) {
      const payAdjustmentId =
        approval.metadata &&
        typeof approval.metadata === "object" &&
        typeof (approval.metadata as any).payAdjustmentId === "string"
          ? String((approval.metadata as any).payAdjustmentId)
          : null;
      if (!payAdjustmentId) continue;
      const existing = approvalByAdjustmentId.get(payAdjustmentId);
      if (!existing || new Date(approval.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
        approvalByAdjustmentId.set(payAdjustmentId, approval);
      }
    }

    return NextResponse.json(
      rows.map((row) => {
        const clientApproval = approvalByAdjustmentId.get(row.id) ?? null;
        return {
          ...row,
          ...normalizePayAdjustmentAmounts(row, clientApproval),
          clientApproval,
          attachmentUrls: Array.isArray(row.attachmentKeys)
            ? row.attachmentKeys
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                .map((key) => ({ key, url: publicUrl(key) }))
            : [],
        };
      })
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
