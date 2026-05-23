import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "OPS_MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.uploadFailure.update({
    where: { id: params.id },
    data: { resolvedAt: new Date(), resolvedBy: session!.user.id },
  });
  return NextResponse.json({ ok: true });
}
