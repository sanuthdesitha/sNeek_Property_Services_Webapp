import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { isWebPushConfigured } from "@/lib/notifications/web-push";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const schema = z.object({ endpoint: z.string().url().max(2000).nullable() });
// Read-only status: no provider call, subscription registration or permission request.
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid device status request." }, { status: 400, headers });
    const [configured, registered] = await Promise.all([
      isWebPushConfigured(),
      parsed.data.endpoint ? db.pushSubscription.count({ where: { userId: session.user.id, endpoint: parsed.data.endpoint } }) : 0,
    ]);
    return NextResponse.json({ configured, registered: registered > 0 }, { headers });
  } catch (err) {
    const status = getApiErrorStatus(err, 503);
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "Could not check device status." }, { status, headers });
  }
}
