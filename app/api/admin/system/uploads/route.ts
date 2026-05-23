import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "OPS_MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
