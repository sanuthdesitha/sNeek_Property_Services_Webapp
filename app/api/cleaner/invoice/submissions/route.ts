import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** The cleaner's own past invoice submissions with their status. */
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);
    const rows = await db.cleanerInvoiceSubmission.findMany({
      where: { cleanerId: session.user.id },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        hours: true,
        totalAmount: true,
        jobCount: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(rows);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load submissions." }, { status });
  }
}
