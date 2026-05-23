import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLEANER");
  if (session instanceof NextResponse) return session;

  const requests = await prisma.cleanerPayAdjustment.findMany({
    where: { cleanerId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ requests, total: requests.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("CLEANER");
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json();
    const { type, requestedHours, requestedRate, reason } = body;

    if (!type || !reason) {
      return apiError("Type and reason are required", 400);
    }

    const request = await prisma.cleanerPayAdjustment.create({
      data: {
        cleanerId: session.user.id,
        type,
        requestedHours: requestedHours ?? null,
        requestedRate: requestedRate ?? null,
        requestedAmount: (requestedHours ?? 0) * (requestedRate ?? 0),
        cleanerNote: reason,
        status: "PENDING",
      },
    });

    return apiSuccess(request);
  } catch (error) {
    console.error("Pay requests API error:", error);
    return apiError("Failed to create pay request", 500);
  }
}
