import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordHiringReply } from "@/lib/workforce/service";

/** Manually log a reply received from a candidate (until inbound capture is set up). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const replyBody = typeof body.body === "string" ? body.body.trim() : "";
    if (!replyBody) {
      return NextResponse.json({ error: "Reply text is required." }, { status: 400 });
    }
    const application = await db.hiringApplication.findUnique({
      where: { id: params.id },
      select: { id: true, email: true },
    });
    if (!application) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }
    await recordHiringReply({
      applicationId: application.id,
      from: typeof body.from === "string" && body.from.trim() ? body.from.trim() : application.email,
      body: replyBody,
      actorId: session.user.id,
      source: "manual",
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not log reply." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
