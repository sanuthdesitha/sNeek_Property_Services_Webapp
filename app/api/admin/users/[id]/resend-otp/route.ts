import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { issueSignupOtp } from "@/lib/auth/registration-otp";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const user = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, email: true, emailVerified: true, isActive: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    if (user.emailVerified && user.isActive) {
      return NextResponse.json({ error: "User is already verified." }, { status: 400 });
    }

    const sent = await issueSignupOtp(user.email, { enforceCooldown: true });
    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: 429 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

