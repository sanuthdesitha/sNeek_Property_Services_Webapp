import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getPrimaryGateway, createPaymentAdapter } from "@/lib/payments/service";

const paySchema = z.object({
  returnUrl: z.string().url(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const body = paySchema.parse(await req.json());

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
    if (invoice.status === "PAID") return NextResponse.json({ error: "Invoice already paid." }, { status: 400 });

    const gateway = await getPrimaryGateway();
    if (!gateway) return NextResponse.json({ error: "No payment gateway configured." }, { status: 503 });

    const adapter = createPaymentAdapter(gateway);
    const amountCents = Math.round(invoice.totalAmount * 100);

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
