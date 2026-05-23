import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) return apiError("User not linked to a client", 403);

  const disputes = await prisma.issueTicket.findMany({
    where: { clientId: session.user.clientId, caseType: "DISPUTE" },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ disputes, total: disputes.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) return apiError("User not linked to a client", 403);

  try {
    const body = await req.json();
    const { jobId, type, description } = body;

    if (!type || !description) {
      return apiError("Type and description are required", 400);
    }

    const dispute = await prisma.issueTicket.create({
      data: {
        clientId: session.user.clientId,
        jobId: jobId ?? null,
        title: `Dispute: ${type}`,
        description,
        caseType: "DISPUTE",
        severity: "HIGH",
        status: "OPEN",
        clientVisible: true,
        clientCanReply: true,
      },
    });

    return apiSuccess(dispute);
  } catch (error) {
    console.error("Disputes API error:", error);
    return apiError("Failed to create dispute", 500);
  }
}
