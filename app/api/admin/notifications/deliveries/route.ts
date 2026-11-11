import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { isListQueryError } from "@/lib/admin/list-query";
import { deliveryDetail, listDeliveries } from "@/lib/notifications/delivery-log";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Unified delivery log (pipeline intents + direct sends + template/provider
 * events). Same roles as `/api/admin/notifications/log`. `?detail=<row id>`
 * returns safe metadata for one row (no bodies, addresses or secrets).
 * Retrying stays on the existing review endpoint (`PATCH .../intents`).
 */
export async function GET(request: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = new URL(request.url).searchParams;
    const detailId = params.get("detail");
    if (detailId) {
      if (detailId.length > 250) return NextResponse.json({ error: "Invalid row." }, { status: 400, headers });
      const detail = await deliveryDetail(detailId);
      if (!detail) return NextResponse.json({ error: "Delivery not found." }, { status: 404, headers });
      return NextResponse.json({ detail }, { headers });
    }
    return NextResponse.json(await listDeliveries(params), { headers });
  } catch (error) {
    if (isListQueryError(error)) return NextResponse.json({ error: error.message, field: error.field }, { status: 400, headers });
    return NextResponse.json({ error: "Could not load the delivery log." }, { status: getApiErrorStatus(error, 503), headers });
  }
}
