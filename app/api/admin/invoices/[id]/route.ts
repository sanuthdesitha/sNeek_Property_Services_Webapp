import { NextRequest, NextResponse } from "next/server";
import { ClientInvoiceStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getClientInvoice, releaseInvoiceConsumables } from "@/lib/billing/client-invoices";
import { canTransitionInvoice } from "@/lib/finance/invoice-transitions";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

const lineUpdateSchema = z.object({
  id: z.string().cuid(),
  description: z.string().trim().min(1).optional(),
  quantity: z.number().positive().optional(),
  unitPrice: z.number().min(0).optional(),
  // Grouping hint for a MANUAL line. null clears it. Rejected on a job-backed
  // line: that line already knows its property through the job, and letting an
  // override win would let an invoice claim work happened somewhere it did not.
  propertyId: z.string().cuid().nullable().optional(),
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  // MANUAL = the one-click "Mark as paid" action (settles the outstanding
  // balance without an itemised bank/card record).
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "STRIPE", "MANUAL", "OTHER"]),
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
  /**
   * Admin-only escape hatch past the lifecycle graph, for correcting a status
   * set in error (a PAID stamped on the wrong invoice, a premature VOID).
   * The graph stays the default for everyone and every other call — this is a
   * deliberate, audited override, never a silent widening of the rules.
   */
  forceStatus: z.boolean().optional(),
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

    let statusOverride: { from: string; to: string } | null = null;
    // Status changes must follow the allowed lifecycle graph, unless an ADMIN
    // has explicitly asked to override it. OPS_MANAGER may drive the invoice
    // through its normal lifecycle but may not step outside it: reopening a
    // PAID invoice is a correction to money already recorded.
    if (body.status && !canTransitionInvoice(existing.status, body.status)) {
      if (!body.forceStatus) {
        return NextResponse.json(
          { error: `Cannot move invoice from ${existing.status} to ${body.status}.` },
          { status: 400 },
        );
      }
      if (session.user.role !== Role.ADMIN) {
        return NextResponse.json(
          { error: "Only an admin can override the invoice status lifecycle." },
          { status: 403 },
        );
      }
      // The audit row is written AFTER the update succeeds (below) — an
      // override that failed to apply must not leave a log entry claiming it
      // happened.
      statusOverride = { from: existing.status, to: body.status };
    }

    // Validate any property hints BEFORE the transaction, so a bad one refuses
    // the whole request rather than half-applying alongside the price edits.
    const propertyHints = (body.updateLines ?? []).filter((l) => l.propertyId !== undefined);
    if (propertyHints.length) {
      for (const hint of propertyHints) {
        const line = existing.lines.find((l) => l.id === hint.id);
        if (!line) {
          return NextResponse.json({ error: "Line not found on this invoice." }, { status: 404 });
        }
        // The whole point of the column: it groups a hand-added charge. A
        // job-backed line reads its property off the job, and pretending
        // otherwise would misstate where the work happened.
        if (line.jobId) {
          return NextResponse.json(
            { error: "This line belongs to a job, so its property comes from that job and cannot be changed." },
            { status: 400 },
          );
        }
      }
      const wanted = Array.from(
        new Set(propertyHints.map((h) => h.propertyId).filter((id): id is string => typeof id === "string")),
      );
      if (wanted.length) {
        // A property from another client would put someone else’s address on
        // this invoice, so ownership is checked rather than assumed.
        const owned = await db.property.findMany({
          where: { id: { in: wanted }, clientId: existing.clientId },
          select: { id: true },
        });
        if (owned.length !== wanted.length) {
          return NextResponse.json(
            { error: "That property does not belong to this client." },
            { status: 400 },
          );
        }
      }
    }

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
              // undefined leaves it alone; null clears it back to "Other charges".
              ...(lineUpdate.propertyId !== undefined ? { propertyId: lineUpdate.propertyId } : {}),
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
    // A forced move OUT of a paid state must not leave the invoice reading as
    // settled: outstandingOf() derives from paidAmount, so stale stamps would
    // hide the payment actions on an invoice the admin just reopened. The
    // metadata.payments ledger is deliberately left intact — the money history
    // survives; only the settled-state stamps are cleared. The override audit
    // row records the from/to for the trail.
    if (
      statusOverride &&
      (existing.status === ClientInvoiceStatus.PAID ||
        existing.status === ClientInvoiceStatus.PART_PAID) &&
      (body.status === ClientInvoiceStatus.DRAFT ||
        body.status === ClientInvoiceStatus.APPROVED ||
        body.status === ClientInvoiceStatus.SENT)
    ) {
      statusData.paidAt = null;
      statusData.paidDate = null;
      statusData.paidAmount = null;
      statusData.paymentMethod = null;
      statusData.paymentReference = null;
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
    if (statusOverride) {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: "invoice.status_override",
          entity: "ClientInvoice",
          entityId: params.id,
          after: {
            from: statusOverride.from,
            to: statusOverride.to,
            invoiceNumber: existing.invoiceNumber,
          } as object,
        },
      });
    }

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

    // VOIDING RELEASES WHAT THE INVOICE CONSUMED. The owner's rule is that a
    // void means "resubmit a new invoice, the items stay unpaid" — and until
    // now the double-bill stamps were never cleared, so a voided invoice took
    // its shopping reimbursements and its client-paid repairs down with it.
    // They stayed marked as billed against an invoice nobody would ever pay,
    // and no future run would pick them up. The charge vanished silently.
    //
    // Jobs need no release: their guard is a live scan of non-VOID invoice
    // lines, so voiding frees them by construction.
    const voiding =
      effectiveStatus === ClientInvoiceStatus.VOID &&
      existing.status !== ClientInvoiceStatus.VOID;
    let released: { shoppingSettlements: number; maintenanceAssignments: number } | null = null;

    const updated = await db.$transaction(async (tx) => {
      if (voiding) {
        released = await releaseInvoiceConsumables(tx, params.id);
      }
      return tx.clientInvoice.update({
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
    });

    if (released) {
      logger.info(
        { invoiceId: params.id, ...(released as object) },
        "[invoice] voided; consumed items released for re-invoicing"
      );
    }

    if (body.recordPayment) {
      // Flag settlements that never went through the client-facing send step
      // (one-click "Mark as paid" on a DRAFT/APPROVED invoice).
      const paidWithoutSending =
        updated.status === ClientInvoiceStatus.PAID &&
        (existing.status === ClientInvoiceStatus.DRAFT ||
          existing.status === ClientInvoiceStatus.APPROVED);
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
            ...(paidWithoutSending ? { note: "Marked paid without sending" } : {}),
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
