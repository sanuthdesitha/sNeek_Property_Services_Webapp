import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { requireRulesEditor } from "@/lib/scheduling-rules/service";
import { buildSchedulingRulesBackup } from "@/lib/scheduling-rules/backup";
import { rulesErrorResponse } from "@/lib/scheduling-rules/http";

/**
 * Download the scheduling rules as a JSON backup (every version, checksum;
 * `?extras=1` adds per-property calendar options, recurring rules and partner
 * schedules for reference). Rule editors only; audited.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await requireRulesEditor(session);
    const includeExtras = req.nextUrl.searchParams.get("extras") === "1";
    const document = await buildSchedulingRulesBackup({ includeExtras });
    await db.auditLog.create({ data: { userId: actor.id, action: "SCHEDULING_RULES_BACKUP_DOWNLOADED", entity: "SchedulingRules", entityId: String(document.liveVersion), after: { checksum: document.checksum, includeExtras } } });
    const day = document.exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="scheduling-rules-v${document.liveVersion}-${day}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
