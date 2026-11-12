import { NextRequest, NextResponse } from "next/server";
import { capabilityRefusal } from "@/lib/rbac/capability-http";
import { invoiceBulkCapabilities } from "@/lib/rbac/invoice-capabilities";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { bulkRequestSchema, runClientInvoiceBulk } from "@/lib/billing/client-invoice-bulk";

/**
 * POST { action: "approve" | "send" | "approve-and-send" | "xero-push", ids }
 * → { action, results: [{ id, invoiceNumber, ok, outcome, reason? }], summary }
 *
 * Same role list (and therefore the same operations-manager pack check, via
 * requireRole) as the single-invoice routes it stands in for.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const parsed = bulkRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid bulk request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const refusal = await capabilityRefusal(session, invoiceBulkCapabilities(parsed.data.action));
    if (refusal) return refusal;
    const response = await runClientInvoiceBulk({
      request: parsed.data,
      actor: session.user,
      origin: req.nextUrl.origin,
    });
    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not run the bulk action.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
