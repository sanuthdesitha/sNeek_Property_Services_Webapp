import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";

const requestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// Statuses where a skip request no longer makes sense (work is done / billed).
const BLOCKED_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];

/**
 * Client requests that an upcoming clean be SKIPPED ("don't clean this turnover").
 * Sets cleanSkipStatus = REQUESTED; admin approves/declines later.
 * POST = create request, DELETE = client cancels their own pending request.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
        const portal = await requireClientPortal({ permission: "bookings" });

    const body = requestSchema.parse(await req.json().catch(() => ({})));
    const job = await db.job.findFirst({
      where: { id: params.id, property: propertyScopeWhere(portal) },
      select: { id: true, status: true, cleanSkipStatus: true, property: { select: { name: true } } },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (BLOCKED_STATUSES.includes(job.status)) {
      return NextResponse.json(
        { error: "This clean can no longer be skipped from the client portal." },
        { status: 400 }
      );
    }
    if (job.cleanSkipStatus === "SKIPPED") {
      return NextResponse.json({ error: "This clean is already marked as skipped." }, { status: 400 });
    }
    if (job.cleanSkipStatus === "REQUESTED") {
      return NextResponse.json({ error: "A skip request is already pending." }, { status: 400 });
    }

    const updated = await db.job.update({
      where: { id: job.id },
      data: {
        cleanSkipStatus: "REQUESTED",
        cleanSkipReason: body.reason?.trim() || null,
        cleanSkipRequestedById: portal.userId,
        cleanSkipDecidedById: null,
        cleanSkipAt: new Date(),
      },
      select: { id: true, cleanSkipStatus: true, cleanSkipReason: true, cleanSkipAt: true },
    });

    // Best-effort admin notification.
    try {
      await notifyAdminsByPush({
        subject: "Skip-clean request",
        body: `${job.property?.name ?? "A client"} requested to skip a scheduled clean${
          body.reason?.trim() ? `: ${body.reason.trim()}` : "."
        }`,
        jobId: job.id,
      });
    } catch {
      // ignore notification failures
    }

    return NextResponse.json({ ok: true, ...updated });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: error?.message ?? "Could not send skip request." },
      { status }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
        const portal = await requireClientPortal({ permission: "bookings" });

    const job = await db.job.findFirst({
      where: { id: params.id, property: propertyScopeWhere(portal) },
      select: { id: true, cleanSkipStatus: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    // Clients may only cancel their own still-pending request.
    if (job.cleanSkipStatus !== "REQUESTED") {
      return NextResponse.json(
        { error: "There is no pending skip request to cancel." },
        { status: 400 }
      );
    }

    const updated = await db.job.update({
      where: { id: job.id },
      data: {
        cleanSkipStatus: "NONE",
        cleanSkipReason: null,
        cleanSkipRequestedById: null,
        cleanSkipDecidedById: null,
        cleanSkipAt: new Date(),
      },
      select: { id: true, cleanSkipStatus: true },
    });

    return NextResponse.json({ ok: true, ...updated });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: error?.message ?? "Could not cancel skip request." },
      { status }
    );
  }
}
