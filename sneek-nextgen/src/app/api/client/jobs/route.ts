import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) {
    return apiError("User is not linked to a client", 403);
  }

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");

  const jobs = await prisma.job.findMany({
    where: {
      property: { clientId: session.user.clientId },
      ...(propertyId && { propertyId }),
    },
    include: {
      property: { select: { name: true, address: true, suburb: true } },
      assignments: { include: { user: { select: { id: true, name: true } } } },
      report: { select: { generatedAt: true, clientVisible: true } },
    },
    orderBy: { scheduledDate: "desc" },
  });

  return apiSuccess({ jobs, total: jobs.length });
}
