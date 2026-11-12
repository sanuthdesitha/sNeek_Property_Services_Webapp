import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { refreshInvoicesFromXero } from "@/lib/billing/client-invoice-xero-sync";
import { XERO_SYNC_MAX_IDS } from "@/lib/billing/client-invoice-xero-sync-types";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  ids: z
    .array(z.string().min(1).max(64))
    .min(1, "Select at least one invoice.")
    .max(XERO_SYNC_MAX_IDS, `Refresh at most ${XERO_SYNC_MAX_IDS} invoices at a time.`),
});

/**
 * POST { ids } → { results: [{ id, invoiceNumber, outcome, reason?, paymentsRecorded }], counts, skipped? }
 *
 * "Refresh from Xero" for one invoice (the editor) or a selection (the list).
 * Same roles as the Xero push (ADMIN and OPS_MANAGER); middleware applies the
 * same finance pack check to an operations manager as for the push route.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    const ids = Array.from(new Set(parsed.data.ids));
    const summary = await refreshInvoicesFromXero({ ids, actor: session.user });
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not refresh from Xero.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
