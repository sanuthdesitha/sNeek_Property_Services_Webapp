import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { requireCapability } from "@/lib/rbac/can";
import { loadDoneByOptions } from "@/lib/laundry/run-page-load";
import { runCorrectionErrorResponse, RUN_CORRECTION_HEADERS } from "@/lib/laundry/run-corrections-http";

export const dynamic = "force-dynamic";

/** GET ?taskIds=a,b — who can be named as "done by" in Change state for these runs. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await requireCapability(session, "laundry.change_state");
    const ids = (new URL(req.url).searchParams.get("taskIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 50);
    if (!ids.length) return NextResponse.json({ error: "Choose at least one run." }, { status: 400, headers: RUN_CORRECTION_HEADERS });
    const options = await loadDoneByOptions(ids, { id: session.user.id, name: session.user.name ?? null });
    return NextResponse.json({ options }, { headers: RUN_CORRECTION_HEADERS });
  } catch (error) {
    return runCorrectionErrorResponse(error);
  }
}
