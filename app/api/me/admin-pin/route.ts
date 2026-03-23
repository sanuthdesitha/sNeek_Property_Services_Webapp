import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clearAdminPin, getAdminPinState, setAdminPin } from "@/lib/security/admin-verification";

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const state = await getAdminPinState(session.user.id);
    return NextResponse.json(state);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load admin PIN state." }, { status });
  }
}

async function verifyCurrentPassword(userId: string, currentPassword: unknown) {
  const password = typeof currentPassword === "string" ? currentPassword.trim() : "";
  if (!password) {
    throw new Error("Current password is required.");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) {
    throw new Error("Current password could not be verified.");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new Error("Current password is incorrect.");
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifyCurrentPassword(session.user.id, body.currentPassword);
    await setAdminPin(session.user.id, body.pin);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save admin PIN." }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifyCurrentPassword(session.user.id, body.currentPassword);
    await clearAdminPin(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not clear admin PIN." }, { status });
  }
}
