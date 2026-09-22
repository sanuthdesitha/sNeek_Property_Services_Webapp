import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { adjustAdminHeldStock, HeldStockEntryError } from "@/lib/inventory/self-held-stock";
import { createHeldStock, getOnHandByHolder, listHeldStock } from "@/lib/inventory/held-stock";

// List current on-hand holdings (flat + grouped by holder) for the dashboard.
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [flat, byHolder] = await Promise.all([listHeldStock({ includeEmpty: true }), getOnHandByHolder({ includeEmpty: true })]);
    return NextResponse.json({ holdings: flat, byHolder });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const createSchema = z.object({
  itemId: z.string().min(1),
  holderUserId: z.string().min(1),
  quantity: z.number().positive(),
  unitCostAud: z.number().min(0).nullable().optional(),
  shoppingRunId: z.string().min(1).nullable().optional(),
  sourceNote: z.string().trim().max(2000).nullable().optional(),
});

// Record stock that was bought and is now on hand with a holder (cleaner/client/QA).
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json());
    const held = await createHeldStock(body);
    return NextResponse.json({ ok: true, id: held.id });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "Exit impersonation before adjusting stock." }, { status: 403, headers });
    const result = await adjustAdminHeldStock(session.user.id, await request.json().catch(() => null));
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : error instanceof HeldStockEntryError ? error.status : error instanceof z.ZodError ? 400 : 503;
    return NextResponse.json({ error: error instanceof HeldStockEntryError ? error.message : status === 400 ? "Invalid stock adjustment." : status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Adjustment could not be confirmed. Retry the same request." }, { status, headers });
  }
}