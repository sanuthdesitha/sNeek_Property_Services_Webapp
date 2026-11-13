import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { assertUnlocked, requireRulesEditor, RulesEditError } from "@/lib/scheduling-rules/service";
import { readSchedulingRulesBackup } from "@/lib/scheduling-rules/backup";
import { canonicalRuleValues } from "@/lib/scheduling-rules/values";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

const schema = z.object({ token: z.string().min(1), text: z.string().max(2_000_000) });

/** Read a backup file: validate format, checksum and values. Saves nothing; publishing it is a separate step. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await requireRulesEditor(session);
    const body = schema.parse(await req.json());
    await assertUnlocked(actor.id, body.token);
    const result = readSchedulingRulesBackup(body.text);
    if (!result.ok) throw new RulesEditError(400, "INVALID_BACKUP", result.problems[0] ?? "This file cannot be used.", { problems: result.problems });
    return noStore({ values: canonicalRuleValues(result.backup.values), sourceVersion: result.backup.sourceVersion, exportedAt: result.backup.exportedAt, versionCount: result.backup.versionCount, hasExtras: Boolean(result.backup.extras) });
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
