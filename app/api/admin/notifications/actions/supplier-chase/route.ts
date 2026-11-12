import { sendSupplierChase } from "@/lib/laundry/supplier-chase";
import { handleGatedOfficeAction } from "../handler";

/**
 * Chase a laundry run's supplier (catalog `laundry.supplier_chase`). ADMIN, or
 * OPS_MANAGER with the Laundry pack at manage; never while impersonating.
 * Stored contact only; rate-limited and audited with the actor's role.
 */
export async function POST(request: Request) {
  return handleGatedOfficeAction(request, "supplier_chase", (actor, input) => sendSupplierChase(actor.id, input, new Date(), actor.role));
}
