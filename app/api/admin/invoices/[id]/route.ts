import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice } from "@/lib/billing/client-invoices";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { db } from "@/lib/db";

const lineUpdateSchema = z.object({
  id: z.string().cuid(),
  description: z.string().trim().min(1).optional(),
  quantity: z.number().positive().optional(),
  unitPrice: z.number().min(0).optional(),
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "STRIPE", "OTHER"]),
  paidDate: z.string().optional().nullable(),
  reference: z.string().trim().max(500).optional().nullable(),
});

const patchSchema = z.object({
  status: z.nativeEnum(ClientInvoiceStatus).optional(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  gstEnabled: z.boolean().optional(),
  // Proper payment-recording procedure — amount received + method + date +
  // reference. Supports partial payments (status PART_PAID until fully settled).
  recordPayment: recordPaymentSchema.optional(),
  updateLines: z.array(lineUpdateSchema).optional(),
  addLine: z.object({
    description: z.string().trim().min(1),
    quantity: z.number().positive().default(1),
    unitPrice: z.number().min(0),
    category: z.string().default("SERVICE"),
  }).optional(),
  removeLineId: z.string().cuid().optional(),
  // Full ordered list of line ids → persisted as sortOrder (group by property + drag).
  reorderLineIds: z.array(z.string().cuid()).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const invoice = await getClientInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json(invoice);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load invoice." }, { status: 400 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.clientInvoice.findUnique({
      where: { id: params.id },
      include: { lines: true },
    });
    if (!existing) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

    // Handle line operations in a transaction
    if (body.updateLines?.length || body.addLine || body.removeLineId || body.reorderLineIds?.length) {
      await db.$transaction(async (tx) => {
        if (body.reorderLineIds?.length) {
          // Persist the given order as sortOrder (0-based); ignore ids not on
          // this invoice via the invoiceId guard.
          await Promise.all(
            body.reorderLineIds.map((lineId, index) =>
              tx.clientInvoiceLine.updateMany({
                where: { id: lineId, invoiceId: params.id },
                data: { sortOrder: index },
              }),
            ),
          );
        }
        if (body.removeLineId) {
          await tx.clientInvoiceLine.delete({ where: { id: body.removeLineId, invoiceId: params.id } });
        }
        if (body.addLine) {
          const lineTotal = Number((body.addLine.quantity * body.addLine.unitPrice).toFixed(2));
          await tx.clientInvoiceLine.create({
            data: {
              invoiceId: params.id,
              description: body.addLine.description,
              quantity: body.addLine.quantity,
              unitPrice: body.addLine.unitPrice,
              lineTotal,
              category: body.addLine.category,
            },
          });
        }
        for (const lineUpdate of (body.updateLines ?? [])) {
          const unitPrice = lineUpdate.unitPrice ?? existing.lines.find((l) => l.id === lineUpdate.id)?.unitPrice ?? 0;
          const quantity = lineUpdate.quantity ?? existing.lines.find((l) => l.id === lineUpdate.id)?.quantity ?? 1;
          await tx.clientInvoiceLine.update({
            where: { id: lineUpdate.id, invoiceId: params.id },
            data: {
              description: lineUpdate.description,
              quantity: lineUpdate.quantity,
              unitPrice: lineUpdate.unitPrice,
              lineTotal: Number((quantity * unitPrice).toFixed(2)),
            },
          });
        }
      });
    }

    // Recalculate totals if lines changed or GST toggle changed
    let subtotal = existing.subtotal;
    let gstAmount = existing.gstAmount;
    let totalAmount = existing.totalAmount;
    let gstEnabled = existing.gstEnabled ?? true;

    if (body.gstEnabled !== undefined) {
      gstEnabled = body.gstEnabled;
    }

    if (body.updateLines?.length || body.addLine || body.removeLineId || body.gstEnabled !== undefined) {
      const updatedLines = await db.clientInvoiceLine.findMany({ where: { invoiceId: params.id } });
      subtotal = updatedLines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
      const breakdown = calculateGstBreakdown(subtotal, { gstEnabled });
      gstAmount = breakdown.gstAmount;
      totalAmount = breakdown.totalAmount;
    }

    const statusData: Record<string, unknown> = {};
    if (body.status === ClientInvoiceStatus.PAID && existing.status !== ClientInvoiceStatus.PAID) {
      statusData.paidAt = new Date();
      // Direct status→PAID (legacy one-click flip): record the full amount as
      // settled so the paid figure is never left blank.
      if (existing.paidAmount == null) statusData.paidAmount = existing.totalAmount;
    }
    if (body.status === ClientInvoiceStatus.SENT && existing.status !== ClientInvoiceStatus.SENT) {
      statusData.sentAt = new Date();
    }

    // ── Payment-recording procedure ──────────────────────────────────────
    // Reuses ClientInvoice columns + a metadata.payments[] ledger. (ClientPayment
    // is gateway-bound — requires a PaymentGateway row — so it can't represent a
    // manually recorded bank/cash/card payment.) Supports partial payments:
    // paidAmount accumulates and the status stays PART_PAID until it reaches the
    // total, then flips to PAID.
    let paymentUpdate: Record<string, unknown> = {};
    let paymentStatus: ClientInvoiceStatus | undefined;
    let paymentLedger: Array<Record<string, unknown>> | undefined;
    if (body.recordPayment) {
      const rp = body.recordPayment;
      const prevPaid = Number(existing.paidAmount ?? 0);
      const newPaid = Number((prevPaid + rp.amount).toFixed(2));
      const fullySettled = newPaid + 0.005 >= Number(existing.totalAmount ?? 0);
      paymentStatus = fullySettled ? ClientInvoiceStatus.PAID : ClientInvoiceStatus.PART_PAID;
      const paidDate = rp.paidDate ? new Date(rp.paidDate) : new Date();
      const priorLedger = Array.isArray((existing.metadata as any)?.payments)
        ? ((existing.metadata as any).payments as Array<Record<string, unknown>>)
        : [];
      paymentLedger = [
        ...priorLedger,
        {
          amount: rp.amount,
          method: rp.method,
          reference: rp.reference?.trim() || null,
          paidDate: paidDate.toISOString(),
          recordedAt: new Date().toISOString(),
          recordedById: session.user.id,
          recordedByName: session.user.name || session.user.email || "Admin",
        },
      ];
      paymentUpdate = {
        paidAmount: newPaid,
        paymentMethod: rp.method,
        paymentReference: rp.reference?.trim() || null,
        paidDate,
        ...(fullySettled ? { paidAt: existing.paidAt ?? new Date() } : {}),
      };
    }

    // Merge dueDate + notes + payment ledger into ONE metadata object. Previously
    // each was its own `metadata: {...existing, X}` spread, so a PATCH sending
    // both fields had the second spread overwrite the first (dropping data).
    const metadataChanged =
      body.dueDate !== undefined || body.notes !== undefined || paymentLedger !== undefined;
    const mergedMetadata = metadataChanged
      ? {
          ...((existing.metadata as object) ?? {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(paymentLedger !== undefined ? { payments: paymentLedger } : {}),
        }
      : undefined;

    const effectiveStatus = paymentStatus ?? body.status;
    const updated = await db.clientInvoice.update({
      where: { id: params.id },
      data: {
        ...(effectiveStatus ? { status: effectiveStatus } : {}),
        ...(body.status ? statusData : {}),
        ...paymentUpdate,
        ...(mergedMetadata !== undefined ? { metadata: mergedMetadata as any } : {}),
        ...(body.gstEnabled !== undefined ? { gstEnabled } : {}),
        subtotal,
        gstAmount,
        totalAmount,
      },
    });

    if (body.recordPayment) {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CLIENT_INVOICE_PAYMENT_RECORD",
          entity: "ClientInvoice",
          entityId: params.id,
          after: {
            amount: body.recordPayment.amount,
            method: body.recordPayment.method,
            reference: body.recordPayment.reference ?? null,
            paidAmount: (paymentUpdate as any).paidAmount,
            status: updated.status,
          } as any,
        },
      });
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not update invoice." }, { status: 400 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.clientInvoice.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not delete invoice." }, { status: 400 });
  }
}
