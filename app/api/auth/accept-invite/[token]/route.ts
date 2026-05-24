import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { upsertAuthUserState } from "@/lib/auth/account-state";

const acceptSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
});

async function loadInvite(token: string) {
  return db.userInvitation.findUnique({
    where: { token },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const invite = await loadInvite(params.token);
  if (!invite) {
    return NextResponse.json({ error: "Invalid invitation." }, { status: 404 });
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ error: "This invitation has already been accepted." }, { status: 410 });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
  }
  if (!invite.user.isActive) {
    return NextResponse.json({ error: "This account is no longer active." }, { status: 410 });
  }
  return NextResponse.json({
    valid: true,
    user: {
      id: invite.user.id,
      email: invite.user.email,
      name: invite.user.name,
      role: invite.user.role,
    },
    expiresAt: invite.expiresAt,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const parsed = acceptSchema.parse(await req.json());
    const invite = await loadInvite(params.token);
    if (!invite) {
      return NextResponse.json({ error: "Invalid invitation." }, { status: 404 });
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: "This invitation has already been accepted." }, { status: 410 });
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }
    if (!invite.user.isActive) {
      return NextResponse.json({ error: "This account is no longer active." }, { status: 410 });
    }

    const passwordHash = await bcrypt.hash(parsed.password, 10);
    const now = new Date();
    await db.$transaction([
      db.user.update({
        where: { id: invite.userId },
        data: { passwordHash, emailVerified: now },
      }),
      db.userInvitation.update({
        where: { id: invite.id },
        data: { acceptedAt: now },
      }),
    ]);

    await upsertAuthUserState(invite.userId, {
      requiresPasswordReset: false,
      welcomeEmailSent: true,
    });

    await db.auditLog.create({
      data: {
        userId: invite.userId,
        action: "ACCEPT_INVITATION",
        entity: "User",
        entityId: invite.userId,
      },
    });

    return NextResponse.json({ ok: true, email: invite.user.email });
  } catch (err: any) {
    if (err?.issues) {
      const msg = err.issues?.[0]?.message ?? "Invalid request.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: err?.message ?? "Could not accept invitation." }, { status: 400 });
  }
}
