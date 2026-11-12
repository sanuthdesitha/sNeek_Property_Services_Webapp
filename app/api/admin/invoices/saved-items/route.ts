import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { readSavedItems, savedItemsSchema, writeSavedItems } from "@/lib/billing/invoice-saved-items";

function authStatus(message: string): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}

/** GET → the saved invoice items. Under /api/admin/invoices, so the finance ops pack applies. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await readSavedItems());
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not load saved items.";
    return NextResponse.json({ error: message }, { status: authStatus(message) });
  }
}

/** PUT { items, expectedUpdatedAt } → replaces the list (audited; stale saves refused). */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = savedItemsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the saved items." }, { status: 400 });
    }
    const result = await writeSavedItems({ items: parsed.data.items, expectedUpdatedAt: parsed.data.expectedUpdatedAt, actorId: session.user.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.payload);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not save the items.";
    return NextResponse.json({ error: message }, { status: authStatus(message) });
  }
}
