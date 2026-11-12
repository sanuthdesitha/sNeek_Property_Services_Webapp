import { sendGuestMessage } from "@/lib/notifications/guest-message";
import { handleGatedOfficeAction } from "../handler";

/**
 * Message a lost and found guest (catalog `guest.message`). ADMIN, or
 * OPS_MANAGER with the Lost & found pack at manage; never while impersonating.
 * Rate-limited and audited with the actor's role.
 */
export async function POST(request: Request) {
  return handleGatedOfficeAction(request, "guest_message", (actor, input) => sendGuestMessage(actor.id, input, new Date(), actor.role));
}
