import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";

export const dynamic = "force-dynamic";

/** Payee-submitted invoices (cleaners AND QA inspectors) for admin review +
 *  Xero push. The query is deliberately unfiltered by role — every payee who
 *  invoices must appear here. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rows = await db.cleanerInvoiceSubmission.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    const cleanerIds = Array.from(new Set(rows.map((r) => r.cleanerId)));
    const users = cleanerIds.length
      ? await db.user.findMany({
          where: { id: { in: cleanerIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return NextResponse.json(
      rows.map((r) => {
        const u = byId.get(r.cleanerId);
        return {
          ...r,
          cleanerName: u?.name || u?.email || "Payee",
          // CLEANER or QA_INSPECTOR — an inspections-only invoice has no cleans,
          // so the reviewer needs to know which kind of payee raised it.
          cleanerRole: u?.role ?? null,
          // The payee's receipt/screenshot for their "I've been paid" claim.
          // Resolved here because the reviewer confirming the claim has to be
          // able to look at the proof, not just read that it exists.
          paidClaimedProofUrls: Array.isArray(r.paidClaimedProofKeys)
            ? r.paidClaimedProofKeys
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                .map((key) => ({ key, url: publicUrl(key) }))
            : [],
        };
      }),
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not list submitted invoices." }, { status });
  }
}
