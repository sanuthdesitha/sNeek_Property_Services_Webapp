import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { attachPendingAdminTasksToJob } from "@/lib/job-tasks/service";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional().nullable(),
  requiresPhoto: z.boolean().optional().default(false),
  requiresNote: z.boolean().optional().default(false),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const tasks = await db.jobTask.findMany({
      where: {
        propertyId: params.id,
        source: "ADMIN",
        jobId: null,
        executionStatus: "OPEN",
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(tasks);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const body = createSchema.parse(await req.json().catch(() => ({})));

    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const task = await db.jobTask.create({
      data: {
        propertyId: params.id,
        source: "ADMIN",
        approvalStatus: "AUTO_APPROVED",
        executionStatus: "OPEN",
        visibleToCleaner: false,
        title: body.title.trim(),
        description: body.description?.trim() || null,
        requiresPhoto: body.requiresPhoto ?? false,
        requiresNote: body.requiresNote ?? false,
        requestedByUserId: session.user.id,
      },
    });

    // Attempt to immediately attach to the next upcoming job for this property
    const nextJob = await db.job.findFirst({
      where: {
        propertyId: params.id,
        status: { notIn: ["COMPLETED", "INVOICED", "SUBMITTED", "QA_REVIEW"] },
        scheduledDate: { gte: new Date() },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
      select: { id: true },
    });

    if (nextJob) {
      await attachPendingAdminTasksToJob({ jobId: nextJob.id, propertyId: params.id });
    }

    return NextResponse.json(task, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
