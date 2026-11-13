import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { assertUnlocked, requireRulesEditor } from "@/lib/scheduling-rules/service";
import { listSchedulingRuleSnapshots, takeSchedulingRuleSnapshot } from "@/lib/scheduling-rules/backup";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

/** Stored backups (before every publish, weekly, on request). */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await requireRulesEditor(session);
    const rows = await listSchedulingRuleSnapshots();
    return noStore({ snapshots: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) });
  } catch (error) {
    return rulesErrorResponse(error);
  }
}

const schema = z.object({ token: z.string().min(1) });

/** Take a backup now. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await requireRulesEditor(session);
    const body = schema.parse(await req.json());
    await assertUnlocked(actor.id, body.token);
    return noStore(await takeSchedulingRuleSnapshot({ source: "MANUAL", actorId: actor.id }));
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
