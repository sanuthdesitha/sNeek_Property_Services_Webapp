import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { updateClientInvoiceInXero } from "@/lib/billing/client-invoice-xero-update";

const schema = z.object({
  /** One per confirmation dialog; a double-click repeats it. */
  requestKey: z.string().trim().min(8).max(100),
  /** Only after the person confirmed the two differing totals shown to them. */
  confirmTotals: z.object({ localTotal: z.number().finite(), xeroTotal: z.number().finite() }).nullish(),
});

/**
 * POST { requestKey, confirmTotals? } → "Update in Xero" for an invoice or
 * credit note already in Xero: re-sends its lines, in the PDF's order, to the
 * same Xero document. Same roles as the push (ADMIN and OPS_MANAGER, with the
 * operations manager's finance pack checked by requireRole); refused while
 * viewing as someone else, like the other money corrections.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const result = await updateClientInvoiceInXero({
      invoiceId: params.id,
      actor: { ...session.user, impersonatedBy: null },
      requestKey: parsed.data.requestKey,
      confirmTotals: parsed.data.confirmTotals ?? null,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not update the invoice in Xero.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
