import { NextRequest, NextResponse } from "next/server";
import { MaintenanceStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { updateMaintenanceStatus } from "@/lib/maintenance/service";
import { ADMIN_ROLES } from "@/lib/maintenance/access";
import { assignMaintenanceItem } from "@/lib/maintenance/workers";
import { recordWorkerAssignedNotice } from "@/lib/maintenance/assign-notice";
import { logger } from "@/lib/logger";

function errStatus(message: string) {
  return message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
}

const ids = z.array(z.string().trim().min(1)).min(1).max(200);

const statusSchema = z.object({
  ids,
  status: z.nativeEnum(MaintenanceStatus),
  note: z.string().trim().max(4000).optional().nullable(),
  resolutionNote: z.string().trim().max(4000).optional().nullable(),
});

/** One visit worker on every selected item (the list's "Assign…"). */
const assignSchema = z.object({
  ids,
  assign: z.object({ workerId: z.string().trim().min(1) }),
});

const bulkSchema = z.union([statusSchema, assignSchema]);

type BulkAssignResult = { id: string; outcome: "done" | "unchanged" | "refused"; reason?: string };

// Bulk status updates are an admin/ops tool only. Each item gets its own
// lifecycle event, and RESOLVED/DISMISSED stamps resolvedBy/resolvedAt. The
// answer carries one result per item (done / unchanged / missing, with the
// status it had before) so the screen can report and undo honestly.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(ADMIN_ROLES);
    const body = bulkSchema.parse(await req.json().catch(() => ({})));

    if ("assign" in body) {
      const results: BulkAssignResult[] = [];
      for (const itemId of Array.from(new Set(body.ids))) {
        try {
          const item = await assignMaintenanceItem({ itemId, workerId: body.assign.workerId, assignedByUserId: session.user.id });
          if (item.unchanged) {
            results.push({ id: itemId, outcome: "unchanged" });
            continue;
          }
          results.push({ id: itemId, outcome: "done" });
          // The assignment is committed; a failed notice must not report it as failed.
          await recordWorkerAssignedNotice({ itemId, workerId: body.assign.workerId }).catch((err) => {
            logger.error({ err, itemId }, "[maintenance-bulk] worker notice failed; the assignment stands");
          });
        } catch (err) {
          results.push({ id: itemId, outcome: "refused", reason: err instanceof Error ? err.message : "Could not assign this item." });
        }
      }
      return NextResponse.json({ results });
    }

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
