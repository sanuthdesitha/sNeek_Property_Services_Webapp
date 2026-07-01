import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Cleaner-submitted invoices for admin review + Xero push. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rows = await db.cleanerInvoiceSubmission.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    const cleanerIds = Array.from(new Set(rows.map((r) => r.cleanerId)));
    const users = cleanerIds.length
      ? await db.user.findMany({ where: { id: { in: cleanerIds } }, select: { id: true, name: true, email: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name || u.email || "Cleaner"]));
    return NextResponse.json(
      rows.map((r) => ({ ...r, cleanerName: nameById.get(r.cleanerId) ?? "Cleaner" })),
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not list cleaner invoices." }, { status });
  }
}
