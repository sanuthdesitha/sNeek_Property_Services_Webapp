import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { lockRules, unlockRules } from "@/lib/scheduling-rules/service";
import { noStore, rulesErrorResponse } from "@/lib/scheduling-rules/http";

const schema = z.object({
  pin: z.string().max(32).optional(),
  password: z.string().max(200).optional(),
  newPin: z.string().max(32).optional(),
}).strict();

/** Unlock the scheduling rules for this person with their own PIN (15 minutes). */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const credentials = schema.parse(await req.json().catch(() => ({})));
    return noStore(await unlockRules(session, credentials));
  } catch (error) {
    return rulesErrorResponse(error);
  }
}

/** Lock again now. */
export async function DELETE() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await lockRules(session);
    return noStore({ ok: true });
  } catch (error) {
    return rulesErrorResponse(error);
  }
}
