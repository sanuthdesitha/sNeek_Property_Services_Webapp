import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { getShoppingGroupMode, setShoppingGroupMode } from "@/lib/inventory/shopping-settings";

/**
 * Inventory hub settings.
 *
 *   GET → { shoppingGroupMode }
 *   PUT   { shoppingGroupMode } → { shoppingGroupMode }
 *
 * `shoppingGroupMode` is the DEFAULT grouping every shopping run opens with
 * ("property" | "item" | "supplier"). Shoppers can still switch mode on the run
 * itself; this is only the starting point, and it lives in AppSetting rather
 * than a hardcode so it is settable from the inventory hub.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json({ shoppingGroupMode: await getShoppingGroupMode() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const shoppingGroupMode = await setShoppingGroupMode(body?.shoppingGroupMode);
    return NextResponse.json({ shoppingGroupMode });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
