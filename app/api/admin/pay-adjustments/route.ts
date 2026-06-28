import { NextRequest, NextResponse } from "next/server";
import { PayAdjustmentStatus, PayAdjustmentType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { publicUrl } from "@/lib/s3";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";

const createSchema = z.object({
  cleanerId: z.string().min(1),
  amount: z.number().positive(),
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(4000).optional().nullable(),
  type: z.nativeEnum(PayAdjustmentType).optional(),
  // Optional job link (by job number) — when present the payment is attached to
  // that job + its property; otherwise it's a standalone extra payment.
  jobNumber: z.string().trim().optional().nullable(),
  propertyId: z.string().trim().optional().nullable(),
  // Admin-added payments are approved by default so they flow straight into the
  // cleaner's invoice; pass false to leave it pending review.
  autoApprove: z.boolean().optional().default(true),
});

// Admin adds an extra payment for a cleaner (linked to a job or standalone).
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());

    const cleaner = await db.user.findFirst({
      where: { id: body.cleanerId, role: Role.CLEANER },
      select: { id: true },
    });
    if (!cleaner) return NextResponse.json({ error: "Cleaner not found." }, { status: 404 });

    let jobId: string | null = null;
    let propertyId: string | null = body.propertyId?.trim() || null;
    if (body.jobNumber?.trim()) {
      const job = await db.job.findFirst({
        where: { jobNumber: body.jobNumber.trim() },
        select: { id: true, propertyId: true },
      });
      if (!job) return NextResponse.json({ error: `No job found with number ${body.jobNumber.trim()}.` }, { status: 404 });
      jobId = job.id;
      propertyId = job.propertyId ?? propertyId;
    }

    const approved = body.autoApprove !== false;
    const created = await db.cleanerPayAdjustment.create({
      data: {
        cleanerId: body.cleanerId,
        jobId,
        propertyId,
        scope: jobId ? "JOB" : "STANDALONE",
        title: body.title.trim(),
        type: body.type ?? PayAdjustmentType.FIXED,
        requestedAmount: body.amount,
        approvedAmount: approved ? body.amount : null,
        status: approved ? PayAdjustmentStatus.APPROVED : PayAdjustmentStatus.PENDING,
        adminNote: body.note?.trim() || null,
        cleanerNote: "Added by admin.",
        reviewedById: approved ? session.user.id : null,
        reviewedAt: approved ? new Date() : null,
      },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: jobId ?? undefined,
        action: "PAY_ADJUSTMENT_ADMIN_CREATED",
        entity: "CleanerPayAdjustment",
        entityId: created.id,
        after: { amount: body.amount, approved, jobId, cleanerId: body.cleanerId } as any,
      },
    });

    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not add payment." }, { status });
  }
}

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
