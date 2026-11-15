import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { recentClientSends } from "@/lib/commercial/delivery-overview";

export const dynamic = "force-dynamic";

/** What happened to recent emails to one client's report and invoice addresses. */
export async function GET(_req: Request, { params }: { params: { clientId: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  try {
    const sends = await recentClientSends(params.clientId);
    if (sends === null) return NextResponse.json({ error: "Client not found." }, { status: 404 });
    return NextResponse.json({ sends }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Recent sends could not be loaded." }, { status: 500 });
  }
}
