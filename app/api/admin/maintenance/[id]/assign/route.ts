import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { assignMaintenanceItem } from "@/lib/maintenance/workers";
import { recordWorkerAssignedNotice } from "@/lib/maintenance/assign-notice";

const schema = z.object({
  workerId: z.string().min(1),
  scheduledFor: z.string().datetime().nullable().optional(),
  shareAccess: z.boolean().optional(),
  contactPersonUserId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const item = await assignMaintenanceItem({
      itemId: params.id,
      workerId: body.workerId,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      shareAccess: body.shareAccess ?? false,
      contactPersonUserId: body.contactPersonUserId ?? null,
      assignedByUserId: session.user.id,
    });

    if (item.unchanged) return NextResponse.json({ ok: true, item, unchanged: true });

    // Notify the worker (if they have a portal login).
    await recordWorkerAssignedNotice({ itemId: params.id, workerId: body.workerId });

    return NextResponse.json({ ok: true, item });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
