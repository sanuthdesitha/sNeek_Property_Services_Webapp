import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { loadSupplierChasePreview } from "@/lib/laundry/supplier-chase";
import { officeSendDecision } from "@/lib/notifications/office-send-permission";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET — "Chase supplier" preview for a run: the drafted message, the
 * supplier's stored contact (for Copy, mailto: and tel:), whether each
 * transport can be used and why not, the cool-down, and whether this account
 * may send from the app (ADMIN, or OPS_MANAGER with the Laundry pack at manage;
 * not while impersonating — the send route re-checks). Everyone who can open
 * the run (ADMIN, OPS_MANAGER) gets the draft to copy.
 */
export async function GET(_req: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const preview = await loadSupplierChasePreview(params.taskId);
    if (!preview) return NextResponse.json({ error: "Laundry run not found." }, { status: 404, headers });
    const decision = await officeSendDecision(session, "supplier_chase");
    return NextResponse.json({
      ...preview,
      canSend: decision.allowed,
      sendNote: decision.allowed
        ? "Sent from the app to the supplier's stored contact. The provider's answer is recorded; delivery is never assumed."
        : decision.reason,
    }, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not prepare the message.";
    return NextResponse.json({ error: message }, { status: getApiErrorStatus(err), headers });
  }
}
