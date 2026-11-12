import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { loadSupplierChasePreview } from "@/lib/laundry/supplier-chase";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET — "Chase supplier" preview for a run: the drafted message, the
 * supplier's stored contact (for Copy, mailto: and tel:), whether each
 * transport can be used and why not, the cool-down, and whether this account
 * may send from the app (administrators, not while impersonating). Everyone who
 * can open the run (ADMIN, OPS_MANAGER) gets the draft to copy.
 */
export async function GET(_req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const preview = await loadSupplierChasePreview(params.taskId);
    if (!preview) return NextResponse.json({ error: "Laundry run not found." }, { status: 404, headers });
    const canSend = session.user.role === Role.ADMIN && !session.impersonation;
    return NextResponse.json({
      ...preview,
      canSend,
      sendNote: canSend
        ? "Sent from the app to the supplier's stored contact. The provider's answer is recorded; delivery is never assumed."
        : session.impersonation
          ? "Messages cannot be sent while impersonating. Copy the message instead."
          : "Only administrators can send this from the app. Copy it or open it in your email or phone app.",
    }, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not prepare the message.";
    return NextResponse.json({ error: message }, { status: getApiErrorStatus(err), headers });
  }
}
