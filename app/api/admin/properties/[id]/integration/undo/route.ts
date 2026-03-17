import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { undoIcalSyncRun } from "@/lib/ical/sync";
import { Role } from "@prisma/client";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = (await req.json().catch(() => ({}))) as { runId?: string };
    if (!body.runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }

    const integration = await db.integration.findUnique({
      where: { propertyId: params.id },
      select: { id: true },
    });
    if (!integration) {
      return NextResponse.json({ error: "No integration found." }, { status: 404 });
    }

    const result = await undoIcalSyncRun({
      propertyId: params.id,
      runId: body.runId,
      revertedById: session.user.id,
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message?.includes("nothing to undo") || err.message?.includes("could not be safely reverted")
            ? 409
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
