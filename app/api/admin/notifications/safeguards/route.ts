import { Role } from "@prisma/client";
import { ZodError, z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { SafeguardConflictError, SafeguardInputError, saveSafeguardLimits } from "@/lib/notifications/safeguards/store";
import { manageRefusal, refusal, safeguardsResponse } from "@/lib/notifications/safeguards/route-support";

/**
 * GET: the Sending safeguards overview (ADMIN; OPS_MANAGER with the
 * notifications pack, checked by the shared middleware).
 * PATCH: new limits. ADMIN only, never while impersonating, with the
 * person's own PIN; values outside the safe bounds are refused (400) and a
 * stale `expectedUpdatedAt` answers 409. Audited (NOTIFICATION_SAFEGUARDS_UPDATED).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return await safeguardsResponse(session);
  } catch (error) {
    return refusal("Could not load the sending safeguards.", getApiErrorStatus(error, 503));
  }
}

const patchSchema = z.object({
  limits: z.unknown(),
  expectedUpdatedAt: z.string().max(40).nullable(),
  security: z.unknown().optional(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const notAllowed = manageRefusal(session);
    if (notAllowed) return refusal(notAllowed, 403);
    const body = patchSchema.parse(await request.json());
    const security = await routeSecurityRefusal(session, securityFromBody(body) ?? null);
    if (security) return security;
    await saveSafeguardLimits(session.user.id, body.limits, body.expectedUpdatedAt);
    return await safeguardsResponse(session);
  } catch (error) {
    if (error instanceof SafeguardInputError) return refusal(error.problems.join(" "), 400);
    if (error instanceof SafeguardConflictError) return refusal(error.message, 409);
    if (error instanceof ZodError || error instanceof SyntaxError) return refusal("Invalid limits.", 400);
    return refusal("Could not save the limits.", getApiErrorStatus(error, 500));
  }
}
