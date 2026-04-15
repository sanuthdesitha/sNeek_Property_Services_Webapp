import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";
import { hash, generateTempPassword } from "@/lib/auth/crypto";

export async function GET(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const { searchParams } = new URL(req.url);
  const role = searchParams.get("role");
  const search = searchParams.get("search");
  const isActive = searchParams.get("isActive");

  const users = await prisma.user.findMany({
    where: {
      ...(role && { role: role as never }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
        ],
      }),
      ...(isActive !== null && { isActive: isActive === "true" }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true,
      hourlyRate: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ users, total: users.length });
}

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN");

  const body = await req.json();
  const { email, name, role, phone, hourlyRate, isActive } = body;

  if (!email || !role) {
    return apiError("email and role are required", 400);
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    return apiError("User with this email already exists", 409);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hash(tempPassword);

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name: name ?? null,
      role,
      phone: phone ?? null,
      hourlyRate: hourlyRate ?? null,
      isActive: isActive ?? true,
      passwordHash,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true,
      hourlyRate: true,
      createdAt: true,
    },
  });

  return apiSuccess({ ...user, tempPassword });
}
