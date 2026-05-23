import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { JobType } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) return apiError("User not linked to a client", 403);

  const quotes = await prisma.quote.findMany({
    where: { clientId: session.user.clientId },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ quotes, total: quotes.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) return apiError("User not linked to a client", 403);

  try {
    const body = await req.json();
    const { jobType, bedrooms, bathrooms, hasBalcony, condition, notes } = body;

    if (!jobType) {
      return apiError("Job type is required", 400);
    }

    const quote = await prisma.quote.create({
      data: {
        clientId: session.user.clientId,
        serviceType: jobType as JobType,
        lineItems: { bedrooms, bathrooms, hasBalcony, condition },
        subtotal: 0,
        gstAmount: 0,
        totalAmount: 0,
        notes: notes ?? null,
        status: "DRAFT",
      },
    });

    return apiSuccess(quote);
  } catch (error) {
    console.error("Quotes API error:", error);
    return apiError("Failed to create quote request", 500);
  }
}
