import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { listShoppingClientCharges, reviewShoppingClientCharge, ShoppingChargeConflict, shoppingClientChargeReviewSchema } from "@/lib/billing/shopping-client-charges";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Shopping charges unavailable.";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : error instanceof z.ZodError ? 400 : error instanceof ShoppingChargeConflict ? 409 : 503;
  return NextResponse.json({ error: status === 503 ? "Shopping charges could not be confirmed. Refresh before retrying." : message }, { status, headers });
}
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try { await requireRole([Role.ADMIN, Role.OPS_MANAGER]); return NextResponse.json({ charges: await listShoppingClientCharges(params.id) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) throw new Error("FORBIDDEN");
    const input = shoppingClientChargeReviewSchema.parse(await req.json().catch(() => null));
    const charges = await listShoppingClientCharges(params.id);
    if (!charges.some(charge => charge.id === input.id)) return NextResponse.json({ error: "Charge not found on this run." }, { status: 404, headers });
    const charge = await reviewShoppingClientCharge(input, session.user.id);
    return NextResponse.json({ ok: true, charge }, { headers });
  } catch (error) { return failure(error); }
}
