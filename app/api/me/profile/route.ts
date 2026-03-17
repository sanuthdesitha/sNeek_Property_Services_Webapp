import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getProfilePolicyForUser } from "@/lib/settings";

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
      },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const editPolicy = await getProfilePolicyForUser(user.id, user.role);
    return NextResponse.json({ user, editPolicy });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = updateSchema.parse(await req.json());
    const current = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, email: true, name: true, phone: true },
    });
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const policy = await getProfilePolicyForUser(current.id, current.role as Role);
    const data: { name?: string; phone?: string | null; email?: string } = {};

    if (body.name !== undefined) {
      if (!policy.canEditName) {
        return NextResponse.json({ error: "Name editing is disabled for your role." }, { status: 403 });
      }
      data.name = body.name;
    }

    if (body.phone !== undefined) {
      if (!policy.canEditPhone) {
        return NextResponse.json({ error: "Phone editing is disabled for your role." }, { status: 403 });
      }
      data.phone = body.phone || null;
    }

    if (body.email !== undefined) {
      if (!policy.canEditEmail) {
        return NextResponse.json({ error: "Email editing is disabled for your role." }, { status: 403 });
      }
      const normalizedEmail = body.email.toLowerCase();
      if (normalizedEmail !== current.email.toLowerCase()) {
        const existing = await db.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
        if (existing && existing.id !== current.id) {
          return NextResponse.json({ error: "Email is already in use." }, { status: 409 });
        }
      }
      data.email = normalizedEmail;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No changes submitted." }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: current.id },
      data,
      select: { id: true, name: true, email: true, phone: true, role: true },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
