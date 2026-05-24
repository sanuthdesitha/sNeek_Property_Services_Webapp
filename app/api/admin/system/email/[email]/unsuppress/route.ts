import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { unsuppress } from "@/lib/email/suppression";

export async function POST(
  _req: NextRequest,
  { params }: { params: { email: string } }
) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "OPS_MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const email = decodeURIComponent(params.email);
  await unsuppress(email);
  return NextResponse.json({ ok: true });
}
