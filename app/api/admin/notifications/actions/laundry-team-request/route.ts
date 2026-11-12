import { Role } from "@prisma/client";
import { sendLaundryTeamRequest } from "@/lib/notifications/office-actions";
import { handleOfficeAction } from "../handler";

/**
 * Ask the laundry partner's team about a run (catalog `laundry.team_request`):
 * confirm pickup / drop-off, the return date, or the drop-off photo. ADMIN and
 * OPS_MANAGER, like the cleaner nudge it replaces for pickup and drop-off;
 * never while impersonating.
 */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN, Role.OPS_MANAGER], (actorId, input) => sendLaundryTeamRequest(actorId, input));
}
