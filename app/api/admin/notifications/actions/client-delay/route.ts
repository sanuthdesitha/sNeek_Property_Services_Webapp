import { Role } from "@prisma/client";
import { sendClientDelayNotice } from "@/lib/notifications/office-actions";
import { handleOfficeAction } from "../handler";

/**
 * Client delay notice (catalog `client.delay_notice`). ADMIN only until the
 * owner decides whether operations managers may message clients this way.
 */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN], sendClientDelayNotice);
}
