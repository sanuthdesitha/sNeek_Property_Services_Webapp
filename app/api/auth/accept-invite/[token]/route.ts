import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { upsertAuthUserState } from "@/lib/auth/account-state";
import { INVITATION_REFUSAL_TEXT, invitationLinkState, type InvitationLinkState } from "@/lib/auth/invitation-state";

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

/** 404 for an unknown link, 410 (with a code) for every other refused state. */
function refusal(state: Exclude<InvitationLinkState, "valid">) {
  return NextResponse.json(
    { error: INVITATION_REFUSAL_TEXT[state], code: state.toUpperCase() },
    { status: state === "invalid" ? 404 : 410 },
  );
}

/** Thrown inside the accept transaction when the invitation changed under us (revoked, accepted, re-issued). */
class InvitationChanged extends Error {}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const invite = await loadInvite(params.token);
  const state = invitationLinkState(invite);
  if (state !== "valid" || !invite) return refusal(state === "valid" ? "invalid" : state);
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
    const state = invitationLinkState(invite);
    if (state !== "valid" || !invite) return refusal(state === "valid" ? "invalid" : state);

    const passwordHash = await bcrypt.hash(parsed.password, 10);
    const now = new Date();
    try {
      await db.$transaction(async (tx) => {
        // Claim the invitation only if it is STILL this token, unused, not
        // withdrawn and not expired: a revoke (or a resend) between the check
        // above and here wins, and no password is set.
        const claimed = await tx.userInvitation.updateMany({
          where: { id: invite.id, token: params.token, acceptedAt: null, revokedAt: null, expiresAt: { gte: now } },
          data: { acceptedAt: now },
        });
        if (claimed.count !== 1) throw new InvitationChanged();
        await tx.user.update({
          where: { id: invite.userId },
          data: { passwordHash, emailVerified: now },
        });
      });
    } catch (error) {
      if (!(error instanceof InvitationChanged)) throw error;
      const current = invitationLinkState(await loadInvite(params.token));
      return refusal(current === "valid" ? "invalid" : current);
    }

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
