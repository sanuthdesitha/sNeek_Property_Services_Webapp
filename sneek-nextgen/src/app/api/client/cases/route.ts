import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) return apiError("User not linked to a client", 403);

  const cases = await prisma.issueTicket.findMany({
    where: { clientId: session.user.clientId },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ cases, total: cases.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) return apiError("User not linked to a client", 403);

  try {
    const body = await req.json();
    const { subject, description, priority } = body;

    if (!subject || !description) {
      return apiError("Subject and description are required", 400);
    }

    const caseItem = await prisma.issueTicket.create({
      data: {
        clientId: session.user.clientId,
        title: subject,
        description,
        severity: priority ?? "MEDIUM",
        status: "OPEN",
        clientVisible: true,
        clientCanReply: true,
      },
    });

    return apiSuccess(caseItem);
  } catch (error) {
    console.error("Cases API error:", error);
    return apiError("Failed to create case", 500);
  }
}
