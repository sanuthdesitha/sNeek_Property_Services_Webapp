import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AccountEmailError, copyInvitationLink, sendAccountEmail } from "@/lib/accounts/account-emails";
import { hireRefusal } from "@/lib/accounts/create-account-rules";
import { HiringError } from "@/lib/hiring/hire";
import { hiringErrorResponse, NO_STORE, requireHiringWriter } from "@/lib/hiring/route-helpers";

const bodySchema = z.object({ action: z.enum(["copy", "resend"]) });

/**
 * POST — the hired person's pending invitation from the application page:
 * "copy" returns the current link (not re-issued, audited), "resend" issues a
 * fresh link and emails it (the old one stops working; the account emails
 * cool-down applies). Allowed to whoever may hire into that person's account
 * role, for the account this application created only; the account-email
 * rules still apply (never yourself, never a higher role, never while testing).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose copy or resend." }, { status: 400, headers: NO_STORE });
    const application = await db.hiringApplication.findUnique({ where: { id: params.id }, select: { status: true, hiredUser: { select: { id: true, role: true } } } });
    if (!application) throw new HiringError(404, "Application not found.");
    if (application.status !== "HIRED" || !application.hiredUser) throw new HiringError(409, "This application has no account yet.");
    const refusal = hireRefusal(creator, application.hiredUser.role);
    if (refusal || !creator.actorRole) throw new HiringError(403, refusal ?? "Only the office can share invitations.");
    const actor = { id: creator.id, role: creator.actorRole, heldRoles: [...creator.heldRoles] };
    if (parsed.data.action === "copy") {
      return NextResponse.json(await copyInvitationLink(actor, application.hiredUser.id), { headers: NO_STORE });
    }
    return NextResponse.json(await sendAccountEmail(actor, application.hiredUser.id, "INVITATION", "HIRING"), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AccountEmailError) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    return hiringErrorResponse(error, "Could not reach the invitation.");
  }
}
