import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { runCleanerInvoiceBulk } from "@/lib/cleaner/invoice-admin-bulk";
import { CLEANER_INVOICE_BULK_ACTIONS, CLEANER_INVOICE_BULK_MAX_IDS } from "@/lib/cleaner/invoice-admin-list-types";

const schema = z.object({
  action: z.enum(CLEANER_INVOICE_BULK_ACTIONS),
  ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one invoice.").max(CLEANER_INVOICE_BULK_MAX_IDS, `Select at most ${CLEANER_INVOICE_BULK_MAX_IDS} invoices at a time.`),
});

/**
 * POST { action: "approve" | "xero-push", ids } → per-row outcomes. Each row
 * runs the single-row action (same transition table, locks and audit rows).
 * Approve is ADMIN only: an operations manager's approve request is refused
 * whole with 403. Record payment has no bulk-safe path (each payment needs its
 * method, amount and bank account), so it is not offered here.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid bulk request." }, { status: 400 });
    if (parsed.data.action === "approve" && session.user.role !== Role.ADMIN) {
      return NextResponse.json({ error: "Only an administrator can approve cleaner invoices." }, { status: 403 });
    }
    return NextResponse.json(await runCleanerInvoiceBulk({ ...parsed.data, ids: Array.from(new Set(parsed.data.ids)), actor: session.user }));
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not run the bulk action.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
