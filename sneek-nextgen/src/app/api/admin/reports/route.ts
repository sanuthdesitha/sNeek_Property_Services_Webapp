import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

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
