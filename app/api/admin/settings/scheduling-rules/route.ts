import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadSchedulingRuleBook } from "@/lib/scheduling-rules/store";
import { canEditRules, recordRulesViewed } from "@/lib/scheduling-rules/service";
import { buildSchedulingRulesView } from "@/lib/scheduling-rules/view";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

export const dynamic = "force-dynamic";

/**
 * Scheduling rules, read-only view (ADMIN and OPS_MANAGER; Settings area at
 * View for a manager pack). The first read ever seeds version 1 from the live
 * settings. Viewing is audited (once per person per 10 minutes).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const book = await loadSchedulingRuleBook();
    const view = await buildSchedulingRulesView(book, { canEdit: await canEditRules(session) });
    await recordRulesViewed(session.user.id);
    return noStore(view);
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
