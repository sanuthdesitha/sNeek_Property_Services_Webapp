import { NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { addCaseChargeToInvoice, caseChargeContext } from "@/lib/billing/client-invoice-case-charge";
import { isSameOrigin, urgentFailure, urgentJson } from "@/lib/inventory/urgent-stock-http";

export const dynamic = "force-dynamic";

/** GET — the case client's draft invoices and the charges already added from this case. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return urgentJson(await caseChargeContext(session.user, params.id));
  } catch (error) {
    return urgentFailure(error, "Could not load the client's draft invoices.");
  }
}

/**
 * POST { requestKey, invoiceId | null, description, amount } — add a manual
 * charge line to a DRAFT invoice of the case's client (or a new blank draft)
 * through the invoice PATCH action. Same rights as editing an invoice.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSameOrigin(req)) return urgentJson({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = { ...session.user, impersonatedBy: session.impersonation?.actorId ?? null };
    return urgentJson(await addCaseChargeToInvoice(actor, params.id, await req.json()));
  } catch (error) {
    return urgentFailure(error, "Could not add the charge.");
  }
}
