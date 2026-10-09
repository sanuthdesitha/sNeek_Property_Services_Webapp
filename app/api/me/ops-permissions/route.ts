import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { getApiErrorStatus } from "@/lib/api/http";
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(
      { levels: await getOpsAccess(session.user) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Could not verify feature access." },
      { status: getApiErrorStatus(error) },
    );
  }
}
