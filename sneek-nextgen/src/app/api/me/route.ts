import { requireApiSession, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      client: { select: { id: true, name: true } },
      notificationPreference: true,
    },
  });

  if (!user) return apiError("User not found", 404);

  return apiSuccess({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    image: user.image,
    isActive: user.isActive,
    hourlyRate: user.hourlyRate,
    bankBsb: user.bankBsb,
    bankAccountNumber: user.bankAccountNumber,
    bankAccountName: user.bankAccountName,
    stripeAccountId: user.stripeAccountId,
    clientId: user.clientId,
    client: user.client,
    notificationPreferences: user.notificationPreference,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const body = await req.json();

  const allowedFields = ["name", "phone", "image", "hourlyRate", "bankBsb", "bankAccountNumber", "bankAccountName"] as const;
  const data: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  return apiSuccess({
    id: updated.id,
    name: updated.name,
    phone: updated.phone,
    hourlyRate: updated.hourlyRate,
    bankBsb: updated.bankBsb,
    bankAccountNumber: updated.bankAccountNumber,
    bankAccountName: updated.bankAccountName,
  });
}
