import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLEANER");
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  const assignments = await prisma.jobAssignment.findMany({
    where: {
      userId: session.user.id,
      ...(status && { responseStatus: status as never }),
    },
    include: {
      job: {
        include: {
          property: { select: { name: true, address: true, suburb: true, latitude: true, longitude: true } },
          laundryTask: { select: { status: true } },
        },
      },
    },
    orderBy: { job: { scheduledDate: "asc" } },
  });

  const jobs = assignments.map((a) => ({
    ...a.job,
    assignment: {
      isPrimary: a.isPrimary,
      responseStatus: a.responseStatus,
      respondedAt: a.respondedAt,
    },
  }));

  return apiSuccess({ jobs, total: jobs.length });
}
