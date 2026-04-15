import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search");
  const isActive = searchParams.get("isActive");

  const clients = await prisma.client.findMany({
    where: {
      ...(isActive !== null && { isActive: isActive === "true" }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
        ],
      }),
    },
    include: {
      _count: {
        select: {
          properties: true,
          invoices: true,
          jobFeedback: true,
        },
      },
      loyaltyAccount: true,
    },
    orderBy: { name: "asc" },
  });

  return apiSuccess({ clients, total: clients.length });
}

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const body = await req.json();

  if (!body.name) {
    return apiError("name is required", 400);
  }

  const client = await prisma.client.create({
    data: {
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
      notes: body.notes,
      isActive: body.isActive ?? true,
    },
  });

  return apiSuccess(client);
}
