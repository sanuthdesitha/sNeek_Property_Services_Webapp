import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { unsuppress } from "@/lib/email/suppression";

export async function POST(
  _req: NextRequest,
  { params }: { params: { email: string } }
) {
  try {
    await requireRole(["ADMIN", "OPS_MANAGER"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  const email = decodeURIComponent(params.email);
  await unsuppress(email);
  return NextResponse.json({ ok: true });
}
