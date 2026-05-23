import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLEANER");
  if (session instanceof NextResponse) return session;

  const items = await prisma.issueTicket.findMany({
    where: { caseType: "LOST_FOUND", assignedToUserId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("CLEANER");
  if (session instanceof NextResponse) return session;

  try {
    const body = await req.json();
    const { propertyId, description, locationFound, notes } = body;

    if (!propertyId || !description) {
      return apiError("Property and description are required", 400);
    }

    const item = await prisma.issueTicket.create({
      data: {
        propertyId,
        title: `Lost & Found: ${description}`,
        description: `${description}${locationFound ? `\nLocation: ${locationFound}` : ""}${notes ? `\nNotes: ${notes}` : ""}`,
        caseType: "LOST_FOUND",
        severity: "LOW",
        status: "OPEN",
        assignedToUserId: session.user.id,
      },
    });

    return apiSuccess(item);
  } catch (error) {
    console.error("Lost found API error:", error);
    return apiError("Failed to report item", 500);
  }
}
