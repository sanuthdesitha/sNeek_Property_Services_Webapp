import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";

export const runtime = "nodejs";

const unsubscribeSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
});

async function removeSubscription(req: NextRequest) {
  const session = await requireSession();
  const parsed = unsubscribeSchema.parse(await req.json().catch(() => ({})));

  // Only remove a subscription owned by the current user.
  await db.pushSubscription.deleteMany({
    where: { endpoint: parsed.endpoint, userId: session.user.id },
  });

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  try {
    return await removeSubscription(req);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not remove push subscription." },
      { status: getApiErrorStatus(err) }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return await removeSubscription(req);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not remove push subscription." },
      { status: getApiErrorStatus(err) }
    );
  }
}
