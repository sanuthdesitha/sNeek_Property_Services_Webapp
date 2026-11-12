import { NextRequest, NextResponse } from "next/server";
import { capabilityRefusal } from "@/lib/rbac/capability-http";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { sendClientInvoice } from "@/lib/billing/client-invoice-send";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = await capabilityRefusal(session, ["invoices.send"]);
    if (refusal) return refusal;
    const body = await req.json().catch(() => ({}));
    // Shared with the bulk route so both apply the same guards.
    // Wave D options are explicit fields; anything but `true` keeps today's behaviour.
    const options = { includePaymentLink: body?.includePaymentLink === true, pushToXero: body?.pushToXero === true };
    const result = await sendClientInvoice({ invoiceId: params.id, to: body?.to, origin: req.nextUrl.origin, actorId: session.user.id, options });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not send invoice.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
