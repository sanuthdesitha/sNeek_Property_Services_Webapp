import { Role } from "@prisma/client";
import { ZodError, z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { setEmergencyStop } from "@/lib/notifications/safeguards/store";
import { manageRefusal, refusal, safeguardsResponse } from "@/lib/notifications/safeguards/route-support";

/**
 * POST { on, reason?, security }: the emergency stop for outbound email, SMS
 * and push (security messages still go; the inbox keeps working). ADMIN only,
 * never while impersonating, with the person's own PIN. Audited both ways.
 */
const bodySchema = z.object({
  on: z.boolean(),
  reason: z.string().max(300).optional().nullable(),
  security: z.unknown().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const notAllowed = manageRefusal(session);
    if (notAllowed) return refusal(notAllowed, 403);
    const body = bodySchema.parse(await request.json());
    const security = await routeSecurityRefusal(session, securityFromBody(body) ?? null);
    if (security) return security;
    await setEmergencyStop(session.user.id, body.on, body.reason ?? null);
    return await safeguardsResponse(session);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return refusal("Invalid request.", 400);
    return refusal("Could not change the emergency stop.", getApiErrorStatus(error, 500));
  }
}
