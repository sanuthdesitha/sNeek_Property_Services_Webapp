import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { updateHiringApplication } from "@/lib/workforce/service";
import { resolveAccountCreator } from "@/lib/accounts/account-creator";
import { hireApplicant, HiringError } from "@/lib/hiring/hire";

/**
 * PATCH — the classic candidate page's save (status, notes, interview,
 * offer, rejection). Kept for that page. Moving to Hired no longer guesses
 * an account role and never emails a password: it goes through "Mark hired
 * and invite" (lib/hiring/hire.ts) with the explicit role on the offer or the
 * role's "Hires become", from the Offer stage, and is refused without one.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const status = String(body.status ?? "NEW").trim().toUpperCase();
    const current = await db.hiringApplication.findUnique({ where: { id: params.id }, select: { status: true } });
    if (!current) return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (status === "HIRED" && current.status !== "HIRED") {
      const creator = await resolveAccountCreator(session);
      const result = await hireApplicant({ applicationId: params.id, creator, sendSms: false });
      return NextResponse.json({ id: params.id, status: "HIRED", hiredUserId: result.outcome.user.id, outcome: result.outcome });
    }
    const application = await updateHiringApplication({
      applicationId: params.id,
      reviewedById: session.user.id,
      status,
      notes: body.notes ? String(body.notes) : null,
      interviewNotes: body.interviewNotes ? String(body.interviewNotes) : null,
      interviewDate: body.interviewDate ? String(body.interviewDate) : null,
      offerDetails: body.offerDetails && typeof body.offerDetails === "object" ? body.offerDetails as any : null,
      rejectionReason: body.rejectionReason ? String(body.rejectionReason) : null,
    });
    return NextResponse.json(application);
  } catch (err: any) {
    if (err instanceof HiringError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err?.message === "HIRED_IS_FINAL") return NextResponse.json({ error: "This person is hired and has an account. Change the account from their page instead." }, { status: 409 });
    return NextResponse.json({ error: err.message ?? "Could not update application." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
