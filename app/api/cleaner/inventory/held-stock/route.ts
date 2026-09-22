import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { listHeldStock } from "@/lib/inventory/held-stock";
import { HeldStockEntryError, recordOwnHeldStock, adjustOwnHeldStock } from "@/lib/inventory/self-held-stock";
import { db } from "@/lib/db";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : error instanceof HeldStockEntryError ? error.status : error instanceof z.ZodError ? 400 : 503;
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : error instanceof HeldStockEntryError ? error.message : status === 400 ? "Invalid stock entry." : "Stock could not be confirmed. Refresh or retry the same entry." }, { status, headers });
}
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const [holdings, items] = await Promise.all([
      listHeldStock({ holderUserId: session.user.id, includeEmpty: true }),
      db.inventoryItem.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, unit: true } }),
    ]);
    return NextResponse.json({ holdings: holdings.map(h => ({ id: h.id, quantity: h.quantity, updatedAt: h.updatedAt.toISOString(), sourceNote: h.sourceNote, item: h.item })), items }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation?.mode === "READ_ONLY") return NextResponse.json({ error: "Read-only impersonation cannot record stock." }, { status: 403, headers });
    const input = await request.json().catch(() => null);
    return NextResponse.json({ ok: true, ...await recordOwnHeldStock(session.user.id, input, session.impersonation?.actorId ?? session.user.id) }, { headers });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation?.mode === "READ_ONLY") return NextResponse.json({ error: "Read-only impersonation cannot adjust stock." }, { status: 403, headers });
    const input = await request.json().catch(() => null);
    return NextResponse.json({ ok: true, ...await adjustOwnHeldStock(session.user.id, input, session.impersonation?.actorId ?? session.user.id) }, { headers });
  } catch (error) { return failure(error); }
}
