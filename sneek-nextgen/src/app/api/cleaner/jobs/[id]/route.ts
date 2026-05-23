import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiRole("CLEANER");
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = await req.json();
  const { action } = body;

  // Verify the job is assigned to this cleaner
  const assignment = await prisma.jobAssignment.findFirst({
    where: { jobId: id, userId: session.user.id },
  });

  if (!assignment) {
    return apiError("Job not assigned to you", 403);
  }

  try {
    if (action === "ACCEPT") {
      await prisma.jobAssignment.update({
        where: { id: assignment.id },
        data: { responseStatus: "ACCEPTED", respondedAt: new Date() },
      });
      return apiSuccess({ action: "ACCEPTED" });
    }

    if (action === "DECLINE") {
      await prisma.jobAssignment.update({
        where: { id: assignment.id },
        data: { responseStatus: "DECLINED", respondedAt: new Date() },
      });
      return apiSuccess({ action: "DECLINED" });
    }

    if (action === "START") {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      await prisma.job.update({
        where: { id },
        data: { status: "IN_PROGRESS", startTime: timeStr },
      });
      return apiSuccess({ action: "STARTED" });
    }

    if (action === "COMPLETE") {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
      await prisma.job.update({
        where: { id },
        data: { status: "SUBMITTED", endTime: timeStr },
      });
      return apiSuccess({ action: "COMPLETED" });
    }

    return apiError("Invalid action", 400);
  } catch (error) {
    console.error("Cleaner job action error:", error);
    return apiError("Failed to update job", 500);
  }
}
