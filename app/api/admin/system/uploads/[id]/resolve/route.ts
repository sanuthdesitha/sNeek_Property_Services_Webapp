import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let session;
  try {
    session = await requireRole(["ADMIN", "OPS_MANAGER"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  await db.uploadFailure.update({
    where: { id: params.id },
    data: { resolvedAt: new Date(), resolvedBy: session.user.id },
  });
  return NextResponse.json({ ok: true });
}
