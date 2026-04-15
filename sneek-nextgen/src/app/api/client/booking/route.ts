import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";
import type { JobType } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) {
    return apiError("User is not linked to a client", 403);
  }

  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  const date = searchParams.get("date");

  const bookings = await prisma.clientBooking.findMany({
    where: {
      clientId: session.user.clientId,
      ...(propertyId && { propertyId }),
    },
    orderBy: { requestedDate: "desc" },
  });

  return apiSuccess({ bookings, total: bookings.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("CLIENT");
  if (session instanceof NextResponse) return session;

  if (!session.user.clientId) {
    return apiError("User is not linked to a client", 403);
  }

  const body = await req.json();
  const { propertyId, jobType, requestedDate, requestedTime, notes } = body;

  if (!propertyId || !jobType || !requestedDate) {
    return apiError("propertyId, jobType, and requestedDate are required", 400);
  }

  // Verify property belongs to client
  const property = await prisma.property.findFirst({
    where: { id: propertyId, clientId: session.user.clientId },
  });

  if (!property) {
    return apiError("Property not found or not accessible", 404);
  }

  const booking = await prisma.clientBooking.create({
    data: {
      clientId: session.user.clientId,
      propertyId,
      jobType: jobType as JobType,
      requestedDate: new Date(requestedDate),
      requestedTime: requestedTime ?? null,
      notes: notes ?? null,
    },
  });

  return apiSuccess(booking);
}
