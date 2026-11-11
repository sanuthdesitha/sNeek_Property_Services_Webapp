import { getClientPortalContext } from "@/lib/client/portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getPrimaryGateway, createPaymentAdapter } from "@/lib/payments/service";
import { getAppBaseUrl } from "@/lib/app-url";
import { invoiceAmountOwing, readCreditedAmount } from "@/lib/finance/receivables";

const paySchema = z.object({
  returnUrl: z.string().url(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const body = paySchema.parse(await req.json());
    // Paying is a finance action: it follows the same switch as viewing invoices.
    const { visibility } = await getClientPortalContext(session.user.id);
    if (!isClientModuleEnabled(visibility, "finance")) {
      return NextResponse.json({ error: "Invoices are not available in your portal. Contact the office to pay." }, { status: 403 });
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }

    // Scope the lookup to the caller's own client — never trust the id alone.
    const invoice = await db.clientInvoice.findFirst({
      where: { id: params.id, clientId: user.clientId },
      include: { client: true },
    });

    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    if (invoice.kind === "CREDIT_NOTE") return NextResponse.json({ error: "A credit note is not paid." }, { status: 400 });
    if (invoice.status === "PAID") return NextResponse.json({ error: "Invoice already paid." }, { status: 400 });
    // Only an invoice that has actually been issued can be paid. This checked
    // PAID alone, so a DRAFT or VOID id would still open a payment intent for a
    // figure nobody had finalised or for one already cancelled. The
    // payment-link route already enforced this; this one did not.
    if (invoice.status !== "SENT" && invoice.status !== "APPROVED" && invoice.status !== "PART_PAID") {
      return NextResponse.json({ error: "This invoice is not payable yet." }, { status: 400 });
    }

    const gateway = await getPrimaryGateway();
    if (!gateway) return NextResponse.json({ error: "No payment gateway configured." }, { status: 503 });

    const adapter = createPaymentAdapter(gateway);
    // After payment the gateway sends the client's browser to this address.
    // It must be this application, not wherever the request body says.
    const appBaseUrl = getAppBaseUrl(req);
    if (!appBaseUrl || new URL(body.returnUrl).origin !== new URL(appBaseUrl).origin) {
      return NextResponse.json({ error: "Invalid return address." }, { status: 400 });
    }
    // A part-paid invoice is charged what is still owed, not the full total again.
    // Approved or sent credit notes reduce it too (the one owing rule).
    const outstanding = invoiceAmountOwing({
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      creditedAmount: await readCreditedAmount(invoice.id),
    });
    if (outstanding <= 0) {
      return NextResponse.json({ error: "Invoice already paid." }, { status: 400 });
    }
    const amountCents = Math.round(outstanding * 100);

    const result = await adapter.createPaymentIntent({
      amount: amountCents,
      currency: "AUD",
      invoiceId: invoice.id,
      customerEmail: invoice.client.email || undefined,
      customerName: invoice.client.name || undefined,
      description: `Invoice ${invoice.invoiceNumber} - ${invoice.client.name}`,
      returnUrl: body.returnUrl,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    // Record the payment attempt
    await db.clientPayment.create({
      data: {
        invoiceId: invoice.id,
        amount: invoice.totalAmount,
        currency: "AUD",
        status: "PENDING",
        gatewayId: gateway.id,
        gatewayProvider: gateway.provider,
        gatewayPaymentId: result.paymentId,
        feeAmount: 0,
        surchargeAmount: 0,
      },
    });

    return NextResponse.json({
      ok: true,
      paymentId: result.paymentId,
      clientSecret: result.clientSecret,
      checkoutUrl: result.checkoutUrl,
      gatewayProvider: gateway.provider,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not create payment." }, { status: 400 });
  }
}
