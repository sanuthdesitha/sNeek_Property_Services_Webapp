import { NextRequest, NextResponse } from "next/server";
import { MaintenanceStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { updateMaintenanceStatus } from "@/lib/maintenance/service";
import { ADMIN_ROLES } from "@/lib/maintenance/access";

function errStatus(message: string) {
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

const bulkSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  status: z.nativeEnum(MaintenanceStatus),
  note: z.string().trim().max(4000).optional().nullable(),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
});

// Bulk status updates are an admin/ops tool only. Each item gets its own
// lifecycle event, and RESOLVED/DISMISSED stamps resolvedBy/resolvedAt.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(ADMIN_ROLES);
    const body = bulkSchema.parse(await req.json().catch(() => ({})));

    const result = await updateMaintenanceStatus({
      ids: body.ids,
      status: body.status,
      userId: session.user.id,
      note: body.note ?? null,
      resolutionNote: body.resolutionNote ?? null,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update items." }, { status: errStatus(err.message) });
  }
}
