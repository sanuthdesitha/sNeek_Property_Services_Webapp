import { Role } from "@prisma/client";
import { ZodError, z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { SafeguardInputError, pauseNotificationType, resumeIncident } from "@/lib/notifications/safeguards/store";
import { manageRefusal, refusal, safeguardsResponse } from "@/lib/notifications/safeguards/route-support";

/**
 * POST { action: "pause", typeKey, note? } pauses a notification type for
 * email, SMS and push (inbox copies kept). POST { action: "resume",
 * incidentId, note? } ends a pause (automatic or manual): pauses never resume
 * on their own. ADMIN only, never while impersonating. Audited.
 */
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause"), typeKey: z.string().min(1).max(120), note: z.string().max(300).optional().nullable() }),
  z.object({ action: z.literal("resume"), incidentId: z.string().min(1).max(60), note: z.string().max(300).optional().nullable() }),
]);

export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const notAllowed = manageRefusal(session);
    if (notAllowed) return refusal(notAllowed, 403);
    const body = bodySchema.parse(await request.json());
    if (body.action === "pause") {
      await pauseNotificationType(session.user.id, body.typeKey, body.note ?? null);
    } else {
      const resolved = await resumeIncident(session.user.id, body.incidentId, body.note ?? null);
      if (!resolved) return refusal("That pause no longer exists.", 404);
    }
    return await safeguardsResponse(session);
  } catch (error) {
    if (error instanceof SafeguardInputError) return refusal(error.problems.join(" "), 400);
    if (error instanceof ZodError || error instanceof SyntaxError) return refusal("Invalid request.", 400);
    return refusal("Could not change the pause.", getApiErrorStatus(error, 500));
  }
}
