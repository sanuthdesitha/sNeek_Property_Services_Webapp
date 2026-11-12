import { Role } from "@prisma/client";
import { sendLaundryCleanerNudge } from "@/lib/notifications/office-actions";
import { handleOfficeAction } from "../handler";

/** Nudge the cleaner(s) on a laundry run (catalog `laundry.cleaner_nudge`). ADMIN and OPS_MANAGER. */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN, Role.OPS_MANAGER], sendLaundryCleanerNudge);
}
