import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; taskId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const task = await db.jobTask.findUnique({
      where: { id: params.taskId },
      select: { id: true, propertyId: true, source: true, jobId: true, executionStatus: true },
    });

    if (!task || task.propertyId !== params.id) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (task.source !== "ADMIN" || task.jobId !== null) {
      return NextResponse.json({ error: "Only unattached admin tasks can be cancelled." }, { status: 400 });
    }

    await db.jobTask.update({
      where: { id: params.taskId },
      data: { executionStatus: "CANCELLED" },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
