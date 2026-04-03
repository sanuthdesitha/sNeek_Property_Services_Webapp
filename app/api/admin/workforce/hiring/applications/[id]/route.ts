import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updateHiringApplication } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const application = await updateHiringApplication({
      applicationId: params.id,
      reviewedById: session.user.id,
      status: String(body.status ?? "NEW"),
      notes: body.notes ? String(body.notes) : null,
      interviewNotes: body.interviewNotes ? String(body.interviewNotes) : null,
      interviewDate: body.interviewDate ? String(body.interviewDate) : null,
      offerDetails: body.offerDetails && typeof body.offerDetails === "object" ? body.offerDetails as any : null,
      rejectionReason: body.rejectionReason ? String(body.rejectionReason) : null,
    });
    return NextResponse.json(application);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update application." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
