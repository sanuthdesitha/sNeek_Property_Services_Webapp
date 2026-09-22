import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { executeHeldStockBatch, heldStockBatchSchema } from "@/lib/inventory/held-stock-batch";
import { HeldStockEntryError } from "@/lib/inventory/self-held-stock";
import { notifyHeldStockDeliveries } from "@/lib/inventory/client-shopping-notifications";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation?.mode === "READ_ONLY") throw new HeldStockEntryError(403, "Read-only impersonation cannot change stock.");
    const input = heldStockBatchSchema.parse(await request.json().catch(() => null));
    const result = await executeHeldStockBatch(session.user.id, session.impersonation?.actorId ?? session.user.id, session.user.role === Role.CLEANER, input);
    let notificationWarning: string | undefined;
    if (input.action === "DELIVER") {
      try { const notified = await notifyHeldStockDeliveries(result.batchId, result.results.filter((row): row is { id: string; deliveryId: string } => Boolean(row.deliveryId))); if (notified.unconfirmed) notificationWarning = "Stock delivery saved, but client notification could not be confirmed. The office can review notification history."; }
      catch { notificationWarning = "Stock delivery saved, but client notification could not be confirmed. Do not record it again."; }
    }
    return NextResponse.json({ ok: true, ...result, notificationWarning }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const conflict = /Not enough on-hand|already been cleared|allocated to another property|different details|Shopping destination|legacy client invoice/.test(message);
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : error instanceof HeldStockEntryError ? error.status : error instanceof z.ZodError ? 400 : conflict ? 409 : 503;
    return NextResponse.json({ error: status === 503 ? "Stock could not be confirmed. Retry the same batch." : status === 400 ? "Invalid stock batch." : message }, { status, headers });
  }
}
