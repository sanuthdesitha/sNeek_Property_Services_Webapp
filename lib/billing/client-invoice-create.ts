/**
 * Creating client invoices by hand (Money step (c)):
 *   - a BLANK draft for a chosen client and period, with no lines; and
 *   - a CREDIT NOTE against an issued invoice, pre-filled with that invoice's
 *     lines negated, which the office may reduce to a partial credit.
 * Both use the existing numbering (issueInvoiceNumber; credit notes on their
 * own CREDIT_NOTE rail, "CN-0001") and the one totals function. Neither
 * touches the original invoice: its lines, number, status history and
 * payments stay exactly as they were.
 */
import { ClientInvoiceStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { issueInvoiceNumber } from "./invoice-sequence";
import { calculateShoppingAwareInvoiceTotals } from "./shopping-client-charges";
import { creditedAmountOf } from "@/lib/finance/receivables";
import { creditNoteSourceRefusal, creditableRemaining, negatedLine } from "./client-invoice-adjustments";
import { actionResult, type InvoiceActionResult, type InvoiceActor } from "./invoice-action-result";

export type BlankInvoiceInput = {
  clientId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  gstEnabled?: boolean;
};

/** A DRAFT with no lines, for charges the generator does not produce. */
export async function createBlankInvoice(input: BlankInvoiceInput, actor: InvoiceActor): Promise<InvoiceActionResult> {
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) {
    return actionResult({ error: "The period start must be on or before the period end." }, 400);
  }
  const [client, settings] = await Promise.all([
    db.client.findUnique({ where: { id: input.clientId }, select: { id: true, isActive: true } }),
    getAppSettings(),
  ]);
  if (!client) return actionResult({ error: "Client not found." }, 404);
  if (!client.isActive) return actionResult({ error: "This client is archived. Restore the client before invoicing them." }, 409);

  const invoiceNumber = await issueInvoiceNumber("CLIENT");
  const created = await db.$transaction(async (tx) => {
    const invoice = await tx.clientInvoice.create({
      data: {
        clientId: client.id,
        invoiceNumber,
        status: ClientInvoiceStatus.DRAFT,
        kind: "INVOICE",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        subtotal: 0,
        gstAmount: 0,
        totalAmount: 0,
        gstEnabled: input.gstEnabled ?? settings.pricing.gstEnabled,
        metadata: { source: "blank-invoice" },
      },
      select: { id: true, invoiceNumber: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "CLIENT_INVOICE_BLANK_CREATED",
        entity: "ClientInvoice",
        entityId: invoice.id,
        after: { invoiceNumber: invoice.invoiceNumber, clientId: client.id } as Prisma.InputJsonObject,
      },
    });
    return invoice;
  });
  return actionResult({ ok: true, id: created.id, invoiceNumber: created.invoiceNumber }, 201);
}

const SOURCE_SELECT = {
  id: true,
  kind: true,
  status: true,
  clientId: true,
  invoiceNumber: true,
  totalAmount: true,
  gstEnabled: true,
  periodStart: true,
  periodEnd: true,
  clientReference: true,
  creditNotes: { select: { status: true, totalAmount: true } },
  lines: {
    select: {
      description: true,
      note: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      category: true,
      sortOrder: true,
      propertyId: true,
      job: { select: { propertyId: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.ClientInvoiceSelect;

type SourceInvoice = Prisma.ClientInvoiceGetPayload<{ select: typeof SOURCE_SELECT }>;

/**
 * The credit-note lines for an invoice. They copy the description, quantity,
 * category (so GST and the Xero account follow the original) and property
 * grouping, negate the price, and deliberately carry NO job, shopping run or
 * shopping charge: a credit note bills nothing, so it must never count as
 * billing a job, lock a shopping allocation or block a shopping run.
 */
export function creditNoteLinesFrom(source: Pick<SourceInvoice, "lines">) {
  return source.lines.map((line, index) =>
    negatedLine({
      description: line.description,
      note: line.note,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      category: line.category,
      sortOrder: index,
      propertyId: line.propertyId ?? line.job?.propertyId ?? null,
    }),
  );
}

/**
 * Raise a DRAFT credit note against a SENT, PART_PAID or PAID invoice. Locks
 * the original's row so two credit notes created together see each other.
 */
export async function createCreditNote(invoiceId: string, actor: InvoiceActor): Promise<InvoiceActionResult> {
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
      const source = await tx.clientInvoice.findUnique({ where: { id: invoiceId }, select: SOURCE_SELECT });
      if (!source) return actionResult({ error: "Invoice not found." }, 404);
      const refusal = creditNoteSourceRefusal(source);
      if (refusal) return actionResult({ error: refusal }, 409);
      if (source.lines.length === 0) return actionResult({ error: "This invoice has no lines to credit." }, 409);
      const remaining = creditableRemaining(source.totalAmount, creditedAmountOf(source.creditNotes));
      if (remaining <= 0.005) {
        return actionResult({ error: `${source.invoiceNumber} has already been fully credited.` }, 409);
      }

      const lines = creditNoteLinesFrom(source);
      const totals = calculateShoppingAwareInvoiceTotals(lines, source.gstEnabled, { kind: "CREDIT_NOTE" });
      const invoiceNumber = await issueInvoiceNumber("CREDIT_NOTE");
      const created = await tx.clientInvoice.create({
        data: {
          clientId: source.clientId,
          invoiceNumber,
          status: ClientInvoiceStatus.DRAFT,
          kind: "CREDIT_NOTE",
          creditsInvoiceId: source.id,
          periodStart: source.periodStart,
          periodEnd: source.periodEnd,
          clientReference: source.clientReference,
          gstEnabled: source.gstEnabled,
          subtotal: totals.subtotal,
          gstAmount: totals.gstAmount,
          totalAmount: totals.totalAmount,
          metadata: { source: "credit-note", creditsInvoiceNumber: source.invoiceNumber },
          lines: { create: lines },
        },
        select: { id: true, invoiceNumber: true },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "CLIENT_INVOICE_CREDIT_NOTE_CREATED",
          entity: "ClientInvoice",
          entityId: created.id,
          after: {
            invoiceNumber: created.invoiceNumber,
            creditsInvoiceId: source.id,
            creditsInvoiceNumber: source.invoiceNumber,
            remainingBefore: remaining,
          } as Prisma.InputJsonObject,
        },
      });
      return actionResult(
        { ok: true, id: created.id, invoiceNumber: created.invoiceNumber, remaining, exceedsRemaining: -totals.totalAmount > remaining + 0.005 },
        201,
      );
    });
    return result;
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Could not create the credit note.";
    return actionResult({ error: message }, 400);
  }
}
