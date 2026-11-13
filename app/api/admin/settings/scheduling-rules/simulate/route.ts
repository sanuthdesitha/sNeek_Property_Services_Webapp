import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { loadSchedulingRuleBook } from "@/lib/scheduling-rules/store";
import { assertUnlocked, requireRulesEditor, RulesEditError } from "@/lib/scheduling-rules/service";
import { simulateLastMonth } from "@/lib/scheduling-rules/preview";
import { validateRuleValues } from "@/lib/scheduling-rules/values";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

const schema = z.object({ token: z.string().min(1), values: z.unknown() });

/** "Test against last month": replays last month through the current and candidate rules. Saves nothing. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await requireRulesEditor(session);
    const body = schema.parse(await req.json());
    await assertUnlocked(actor.id, body.token);
    const validated = validateRuleValues(body.values);
    if (!validated.ok) throw new RulesEditError(400, "INVALID_VALUES", "Some values are not allowed.", { problems: validated.problems });
    const book = await loadSchedulingRuleBook();
    return noStore(await simulateLastMonth(book, validated.values));
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
