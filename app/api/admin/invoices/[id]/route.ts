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

const patchSchema = z.object({
  status: z.nativeEnum(ClientInvoiceStatus).optional(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  gstEnabled: z.boolean().optional(),
  updateLines: z.array(lineUpdateSchema).optional(),
  addLine: z.object({
    description: z.string().trim().min(1),
    quantity: z.number().positive().default(1),
    unitPrice: z.number().min(0),
    category: z.string().default("SERVICE"),
  }).optional(),
  removeLineId: z.string().cuid().optional(),
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
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));

    const existing = await db.clientInvoice.findUnique({
      where: { id: params.id },
      include: { lines: true },
    });
    if (!existing) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

    // Handle line operations in a transaction
    if (body.updateLines?.length || body.addLine || body.removeLineId) {
      await db.$transaction(async (tx) => {
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
    }
    if (body.status === ClientInvoiceStatus.SENT && existing.status !== ClientInvoiceStatus.SENT) {
      statusData.sentAt = new Date();
    }

    const updated = await db.clientInvoice.update({
      where: { id: params.id },
      data: {
        ...(body.status ? { status: body.status, ...statusData } : {}),
        ...(body.dueDate !== undefined ? { metadata: { ...(existing.metadata as object ?? {}), dueDate: body.dueDate } } : {}),
        ...(body.notes !== undefined ? { metadata: { ...(existing.metadata as object ?? {}), notes: body.notes } } : {}),
        ...(body.gstEnabled !== undefined ? { gstEnabled } : {}),
        subtotal,
        gstAmount,
        totalAmount,
      },
    });
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
