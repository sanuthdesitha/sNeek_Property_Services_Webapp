import { Role } from "@prisma/client";
import { sendSupplierChase } from "@/lib/laundry/supplier-chase";
import { handleOfficeAction } from "../handler";

/** Chase a laundry run's supplier (catalog `laundry.supplier_chase`). ADMIN only; stored contact only; rate-limited and audited. */
export async function POST(request: Request) {
  return handleOfficeAction(request, [Role.ADMIN], (actorId, input) => sendSupplierChase(actorId, input));
}
