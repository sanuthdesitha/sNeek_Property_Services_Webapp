import { Role } from "@prisma/client";
import { sendStaffMessage } from "@/lib/notifications/office-actions";
import { handleOfficeAction } from "../handler";

/** Message to selected staff (catalog `office.staff_message`). ADMIN and OPS_MANAGER. */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN, Role.OPS_MANAGER], sendStaffMessage);
}
