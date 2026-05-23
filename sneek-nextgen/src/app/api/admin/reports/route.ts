import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");

  const reports = await prisma.report.findMany({
    where: {
      ...(jobId && { jobId }),
    },
    include: {
      job: {
        include: {
          property: { select: { name: true, address: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ reports, total: reports.length });
}
