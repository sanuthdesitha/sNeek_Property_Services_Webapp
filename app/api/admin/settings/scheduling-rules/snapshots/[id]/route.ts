import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { requireRulesEditor, RulesEditError } from "@/lib/scheduling-rules/service";
import { readSnapshotBackup } from "@/lib/scheduling-rules/backup";
import { canonicalRuleValues } from "@/lib/scheduling-rules/values";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

/** The rule values stored in one snapshot, re-validated, for a restore review. Saves nothing. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await requireRulesEditor(session);
    const result = await readSnapshotBackup(params.id);
    if (!result.ok) throw new RulesEditError(400, "INVALID_BACKUP", result.problems[0] ?? "This snapshot cannot be used.", { problems: result.problems });
    return noStore({ values: canonicalRuleValues(result.backup.values), sourceVersion: result.backup.sourceVersion, exportedAt: result.backup.exportedAt });
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
