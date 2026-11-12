import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { BULK_FIX_MAX_IDS, bulkMarkFixed } from "@/lib/quality/bulk-fix";
import { FIXED_RECTIFICATION_STATUSES } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.literal("mark-fixed"),
  ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_FIX_MAX_IDS),
  status: z.enum(FIXED_RECTIFICATION_STATUSES),
});

/**
 * Bulk "Mark fixed" from the Quality hub. ADMIN and OPS_MANAGER only (the hub
 * is read-only for QA inspectors). Each row runs the same rectify transaction
 * as PATCH /api/admin/qa/issues/[id] and reports its own outcome.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Send action "mark-fixed", 1 to ${BULK_FIX_MAX_IDS} issue ids and a fixed status.` },
      { status: 400 },
    );
  }
  try {
    const result = await bulkMarkFixed({
      ids: parsed.data.ids,
      status: parsed.data.status,
      actor: { id: session.user.id, role: session.user.role },
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Could not mark these issues fixed." }, { status: 500 });
  }
}
