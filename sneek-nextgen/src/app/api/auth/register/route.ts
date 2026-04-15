import { prisma } from "@/lib/db/prisma";
import { hash } from "@/lib/auth/crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Role } from "@prisma/client";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, password, phone, role } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existing) {
    return NextResponse.json({ error: "User with this email already exists" }, { status: 409 });
  }

  const passwordHash = await hash(password);

  const userRole: Role = ["ADMIN", "OPS_MANAGER", "CLEANER", "CLIENT", "LAUNDRY"].includes(role)
    ? (role as Role)
    : "CLEANER";

  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name: name ?? null,
      phone: phone ?? null,
      role: userRole,
      passwordHash,
      isActive: false, // Requires admin activation or OTP verification
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  // TODO: Send OTP verification email

  return NextResponse.json({ user }, { status: 201 });
}
