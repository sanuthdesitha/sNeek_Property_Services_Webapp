import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole(["ADMIN", "OPS_MANAGER"]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  const url = new URL(req.url);
  const unresolved = url.searchParams.get("unresolved") === "true";
  const failures = await db.uploadFailure.findMany({
    where: unresolved ? { resolvedAt: null } : undefined,
    orderBy: { occurredAt: "desc" },
    take: 100,
    include: {
      user: { select: { name: true, email: true } },
      job: { select: { jobNumber: true } },
    },
  });
  return NextResponse.json({ failures });
}
