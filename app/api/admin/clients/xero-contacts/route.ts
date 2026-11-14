import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { canEditClientPaymentTerms } from "@/lib/billing/client-payment-terms";
import { hasActiveXeroConnection, searchXeroContacts } from "@/lib/xero/client";

const headers = { "Cache-Control": "private, no-store" };

/**
 * GET /api/admin/clients/xero-contacts?q= — Add client's "Xero contact"
 * lookup. Read-only (GET through the existing Xero token service); creates or
 * changes nothing in Xero. Administrators, or operations managers who manage
 * finance (the same rule as payment terms). Not connected is said in words.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = { id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? [session.user.role]).map(String) };
    if (!(await canEditClientPaymentTerms(actor))) {
      return NextResponse.json({ error: "Only an administrator, or an operations manager who manages finance, can link a Xero contact." }, { status: 403, headers });
    }
    if (!(await hasActiveXeroConnection())) {
      return NextResponse.json({ connected: false, contacts: [], reason: "Xero is not connected. Leave it unlinked; the Xero sync links it later." }, { headers });
    }
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
    const result = await searchXeroContacts(q);
    if (!result.ok) return NextResponse.json({ connected: true, contacts: [], reason: `Xero could not be searched: ${result.reason}` }, { headers });
    return NextResponse.json({ connected: true, contacts: result.contacts, reason: null }, { headers });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not search Xero." : err.message }, { status, headers });
  }
}
