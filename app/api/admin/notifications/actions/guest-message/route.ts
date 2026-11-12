import { Role } from "@prisma/client";
import { sendGuestMessage } from "@/lib/notifications/guest-message";
import { handleOfficeAction } from "../handler";

/** Message a lost and found guest (catalog `guest.message`). ADMIN only; rate-limited and audited. */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN], (actorId, input) => sendGuestMessage(actorId, input));
}
