import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { setLaundryPlannedTimes } from "@/lib/laundry/planned-times";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** PATCH { pickupTime, dropoffTime, expectedUpdatedAt? } — planned clock times ("HH:mm" or null). Same roles as editing a run. */
export async function PATCH(req: NextRequest, { params }: { params: { taskId: string } }) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return urgentJson(await setLaundryPlannedTimes(session.user.id, params.taskId, await req.json()));
  } catch (error) {
    return urgentFailure(error, "Could not save the planned times.");
  }
}
