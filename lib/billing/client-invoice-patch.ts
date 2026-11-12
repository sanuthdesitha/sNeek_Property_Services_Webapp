/**
 * The client-invoice PATCH action (status moves, payments, line edits, reverse),
 * moved out of `app/api/admin/invoices/[id]/route.ts` so the single-invoice
 * route and the bulk route run exactly the same guards: the row lock, the
 * started-work review, the transition graph, the Xero and payment-evidence
 * locks and the audit rows. Behaviour is unchanged; only the response type is
 * now an `InvoiceActionResult` the caller turns into HTTP.
 */
import { ClientInvoiceStatus, Role, type Prisma } from "@prisma/client";
import { z } from "zod";
import { releaseInvoiceConsumables } from "@/lib/billing/client-invoices";
import {
  canReverseInvoice,
  canTransitionInvoice,
  reverseRefusalReason,
} from "@/lib/finance/invoice-transitions";
import { calculateShoppingAwareInvoiceTotals } from "@/lib/billing/shopping-client-charges";
import { creditedAmountOf } from "@/lib/finance/receivables";
import { creditNoteVoidRebillRefusal, refreshCreditCoverage, returnInvoicedJobsToBillable } from "./invoice-job-release";
import { termsSnapshotFor } from "./invoice-terms";
import { sendClientPaymentReceipt } from "./client-payment-receipt";
import { SYSTEM_ACTOR_LABELS, SYSTEM_XERO_SYNC_ACTOR, systemActorMarker } from "@/lib/audit/system-actor";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { assertStartedWorkReviewed, readStartedWorkReview } from "@/lib/billing/started-work-reconciliation";
import { actionResult, type InvoiceActionResult, type InvoiceActor } from "./invoice-action-result";
import {
  PAYMENT_EVIDENCE_REFUSAL,
  XERO_ISSUED_REFUSAL,
  XERO_RESERVATION_REFUSAL,
  emptyInvoiceRefusal,
  hasPaymentEvidence,
  invoiceContentLock,
  isShoppingLockedLine,
  isXeroExportPending,
} from "./client-invoice-guards";
import {
  DISCOUNT_BELOW_ZERO_REFUSAL,
  DISCOUNT_CATEGORY,
  LIVE_CREDIT_NOTES_REFUSAL,
  creditNoteTotalRefusal,
  invoiceGoesBelowZero,
  resolveDiscount,
} from "./client-invoice-adjustments";
import {
  addDiscountSchema,
  contentEditRequested,
  creditLimitFor,
  kindRuleRefusal,
  securitySchema,
  verifyInvoiceSecurity,
} from "./client-invoice-patch-rules";
import { draftFieldsSchema, draftFieldsRequested, draftFieldsUpdate } from "./client-invoice-draft-fields";
import { leavesDraft, approvalRuleRefusal } from "./client-invoice-approval-rules";
import { staleInvoiceRefusal } from "./client-invoice-stale-guard";
import { caseChargeRefusal } from "./client-invoice-case-charge-rules";

const lineUpdateSchema = z.object({
  id: z.string().cuid(),
  description: z.string().trim().min(1).optional(),
  quantity: z.number().positive().optional(),
  // Sign is checked per kind (kindRuleRefusal): charges on an invoice are zero
  // or more, credit-note lines zero or less.
  unitPrice: z.number().finite().optional(),
  // Grouping hint for a MANUAL line. null clears it. Rejected on a job-backed
  // line: that line already knows its property through the job, and letting an
  // override win would let an invoice claim work happened somewhere it did not.
  propertyId: z.string().cuid().nullable().optional(),
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  // MANUAL = the one-click "Mark as paid" action (settles the outstanding
  // balance without an itemised bank/card record).
  // XERO is accepted only from the Xero status pull (see XeroPaymentSource);
  // a person records money with one of the other methods.
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "STRIPE", "MANUAL", "OTHER", "XERO"]),
  paidDate: z.string().optional().nullable(),
  reference: z.string().trim().max(500).optional().nullable(),
  /**
   * S3 key for a remittance advice, bank screenshot or receipt the client sent.
   * Stored on the ledger entry rather than the invoice: an invoice can be paid
   * in several instalments and each one has its own proof.
   */
  receiptKey: z.string().trim().max(512).optional().nullable(),
});

const patchSchema = z.object({
  status: z.nativeEnum(ClientInvoiceStatus).optional(),
  /**
   * REVERSE — bring this invoice back to editable, keeping its identity.
   *
   * Its own field rather than a status move, because it is not one: it clears
   * the settled stamps, keeps the number, the lines and the payment history,
   * and deliberately does NOT release the invoice's items the way a void does.
   * Expressed as `status: "DRAFT"` it would need forceStatus and would be
   * indistinguishable in the audit log from an admin dragging a paid invoice
   * backwards by hand.
   */
  reverse: z
    .object({ reason: z.string().trim().max(500).optional().nullable() })
    .optional(),
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
    unitPrice: z.number().finite(),
    category: z.string().default("SERVICE"),
    /** Wave F: the case this charge comes from ("Add charge to invoice"). Draft invoices of the case's client only. */
    caseId: z.string().trim().min(1).max(64).optional(),
  }).optional(),
  /** A DISCOUNT line: a positive amount or a percentage of the current subtotal. */
  addDiscount: addDiscountSchema.optional(),
  /** The client's reference / PO number. Content: locked once sent. */
  clientReference: z.string().trim().max(100).nullable().optional(),
  /** Note to the client printed on the PDF. Content: locked once sent. */
  clientNote: z.string().trim().max(2000).nullable().optional(),
  /** PIN or password, required to remove a line. Verified, never stored or logged. */
  security: securitySchema,
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
  /**
   * Stale-write guard (Wave D): the invoice's updatedAt the caller last read.
   * When given and the stored row has changed since, nothing is written and
   * the answer is 409 with the current token. Callers that send none are
   * unaffected.
   */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  // Bill to, period and due terms of a DRAFT (client-invoice-draft-fields.ts).
  ...draftFieldsSchema.shape,
});

function removalRequest(body: unknown): { security: { pin?: string; password?: string } | undefined } | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as { removeLineId?: unknown; security?: unknown };
  if (raw.removeLineId === undefined || raw.removeLineId === null) return null;
  const parsed = securitySchema.safeParse(raw.security);
  return { security: parsed.success ? parsed.data : undefined };
}

/** Thrown inside the transaction so a refused PATCH rolls back earlier line changes. */
class RefusedInvoicePatch extends Error {
  constructor(readonly result: InvoiceActionResult) {
    super("Invoice patch refused");
  }
}

/**
 * A payment the Xero status pull found. Its Xero payment id is the idempotency
 * key: it is stored on the ledger entry and a payment id is recorded at most
 * once, ever. Only the sync service passes this; the HTTP route never does.
 */
export type XeroPaymentSource = {
  paymentId: string;
  /** Who started the pull: the hourly job, or a person pressing "Refresh from Xero". */
  trigger: "scheduled" | "manual";
};

/** Refusal code when a Xero payment is more than this invoice still owes. */
export const XERO_PAYMENT_EXCEEDS_OWING = "XERO_PAYMENT_EXCEEDS_OWING";

/**
 * Apply one PATCH body to one invoice under its row lock. Notifications queued
 * by the action run only after the transaction commits.
 */
export async function patchClientInvoice(input: {
  invoiceId: string;
  body: unknown;
  actor: InvoiceActor;
  xeroPayment?: XeroPaymentSource;
}): Promise<InvoiceActionResult> {
  const afterCommit: Array<() => Promise<unknown>> = [];
  // Removing a line needs the administrator's own PIN or password, checked
  // here on the server before the row lock is taken (bcrypt is slow).
  const removal = removalRequest(input.body);
  if (removal) {
    const refusal = await verifyInvoiceSecurity(input.actor, removal.security);
    if (refusal) return refusal;
  }
  try {
    const response = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${input.invoiceId} FOR UPDATE`;
      // Existing nested line/total blocks share this one transaction.
      const scoped = new Proxy(tx, { get(target, property) {
        if (property === "$transaction") return async (fn: (client: Prisma.TransactionClient) => Promise<unknown>) => fn(tx);
        return Reflect.get(target, property);
      } }) as typeof db;
      const result = await patchLockedInvoice(input.body, { id: input.invoiceId }, input.actor, scoped, afterCommit, input.xeroPayment);
      if (result.status >= 400) throw new RefusedInvoicePatch(result); // Roll back earlier line changes too.
      return result;
    });
    for (const action of afterCommit) void action().catch(error => logger.error({ error }, "Invoice notification failed after commit"));
    return response;
  } catch (error) {
    if (error instanceof RefusedInvoicePatch) return error.result;
    const message = error instanceof Error ? error.message : "Could not update invoice.";
    return actionResult({ error: message }, message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 409);
  }
}

async function patchLockedInvoice(
  rawBody: unknown,
  params: { id: string },
  actor: InvoiceActor,
  db: typeof import("@/lib/db").db,
  afterCommit: Array<() => Promise<unknown>>,
  xeroPayment?: XeroPaymentSource,
): Promise<InvoiceActionResult> {
  try {
    const session = { user: actor };
    const body = patchSchema.parse(rawBody ?? {});

    const existing = await db.clientInvoice.findUnique({
      where: { id: params.id },
      include: { lines: true },
    });
    if (!existing) return actionResult({ error: "Invoice not found." }, 404);
    const stale = staleInvoiceRefusal(existing.updatedAt, body.expectedUpdatedAt);
    if (stale) return stale;
    const protectedShoppingLine = (id: string) => existing.lines.find(line => line.id === id && isShoppingLockedLine(line));
    if ((body.removeLineId && protectedShoppingLine(body.removeLineId)) || body.updateLines?.some(line => protectedShoppingLine(line.id) && (line.quantity !== undefined || line.unitPrice !== undefined || line.propertyId !== undefined))) {
      return actionResult({ error: "Shopping allocations are locked to their reviewed amounts. Void this invoice and review the shopping charge before generating its replacement." }, 409);
    }
    if (body.addLine?.category.startsWith("SHOPPING_")) return actionResult({ error: "Add shopping charges through the shopping run review so expenses and time are tracked once." }, 400);
    if (body.addLine?.category === DISCOUNT_CATEGORY) return actionResult({ error: "Add a discount with Add discount." }, 400);
    if (body.addLine?.caseId) {
      const caseRefusal = await caseChargeRefusal(db, existing, body.addLine.caseId);
      if (caseRefusal) return actionResult({ error: caseRefusal }, 409);
    }
    const kindRefusal = kindRuleRefusal(existing, body);
    if (kindRefusal) return kindRefusal;
    const xeroRefusal = await xeroPaymentRefusal(db, existing, body, xeroPayment);
    if (xeroRefusal) return xeroRefusal;

    if (isXeroExportPending(existing.metadata)) return actionResult({ error: XERO_RESERVATION_REFUSAL }, 409);
    const editsContent = contentEditRequested(body);
    if (body.status === "APPROVED" || body.status === "SENT" || body.status === "PAID" || body.status === "PART_PAID" || body.recordPayment) {
      if (editsContent && readStartedWorkReview(existing.metadata)) throw new Error("Save and review draft edits before performing a financial action.");
      await assertStartedWorkReviewed(existing, db, body.status === "APPROVED" && !body.recordPayment);
    }
    if (existing.xeroInvoiceId && (editsContent || body.reverse || body.status === "VOID" || body.forceStatus)) {
      return actionResult({ error: XERO_ISSUED_REFUSAL }, 409);
    }
    if (hasPaymentEvidence(existing) && (editsContent || body.reverse || body.forceStatus || body.status === "VOID")) {
      return actionResult({ error: PAYMENT_EVIDENCE_REFUSAL }, 409);
    }
    // The shared content lock (also the editor's read-only reason): once SENT,
    // PART_PAID, PAID or VOID, content changes go through a credit note.
    if (editsContent) {
      const lock = invoiceContentLock(existing);
      if (!lock.editable) return actionResult({ error: lock.reason }, 409);
    }
    if (body.status === ClientInvoiceStatus.VOID && existing.status !== ClientInvoiceStatus.VOID && existing.kind === "INVOICE") {
      const liveCredits = await db.clientInvoice.count({ where: { creditsInvoiceId: params.id, status: { not: ClientInvoiceStatus.VOID } } });
      if (liveCredits > 0) return actionResult({ error: LIVE_CREDIT_NOTES_REFUSAL }, 409);
    }
    // Bill to, period, due terms: DRAFT only, validated under this row lock.
    const draftFields = draftFieldsRequested(body) ? await draftFieldsUpdate(db, existing, body) : null;
    if (draftFields && !draftFields.ok) return actionResult({ error: draftFields.error }, draftFields.status);
    const discount = body.addDiscount ? resolveDiscount(body.addDiscount, existing.lines) : null;
    if (discount && !discount.ok) return actionResult({ error: discount.error }, 400);

    if (body.forceStatus && body.status && !canTransitionInvoice(existing.status, body.status)) {
      return actionResult({ error: "Financial lifecycle overrides are disabled. Use a reconciled correction." }, 409);
    }
    let statusOverride: { from: string; to: string } | null = null;
    // Status changes must follow the allowed lifecycle graph, unless an ADMIN
    // has explicitly asked to override it. OPS_MANAGER may drive the invoice
    // through its normal lifecycle but may not step outside it: reopening a
    // PAID invoice is a correction to money already recorded.
    if (body.status && !canTransitionInvoice(existing.status, body.status)) {
      if (!body.forceStatus) {
        return actionResult(
          { error: `Cannot move invoice from ${existing.status} to ${body.status}.` }, 400);
      }
      if (session.user.role !== Role.ADMIN) {
        return actionResult(
          { error: "Only an admin can override the invoice status lifecycle." }, 403);
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
          return actionResult({ error: "Line not found on this invoice." }, 404);
        }
        // The whole point of the column: it groups a hand-added charge. A
        // job-backed line reads its property off the job, and pretending
        // otherwise would misstate where the work happened.
        if (line.jobId) {
          return actionResult(
            { error: "This line belongs to a job, so its property comes from that job and cannot be changed." }, 400);
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
          return actionResult(
            { error: "That property does not belong to this client." }, 400);
        }
      }
    }

    // Handle line operations in a transaction
    if (body.updateLines?.length || body.addLine || body.addDiscount || body.removeLineId || body.reorderLineIds?.length) {
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
              caseId: body.addLine.caseId ?? null,
            },
          });
        }
        if (discount?.ok) {
          const lastOrder = existing.lines.reduce((max, line) => Math.max(max, line.sortOrder), 0);
          const amount = discount.amount;
          await tx.clientInvoiceLine.create({
            data: {
              invoiceId: params.id,
              description: body.addDiscount?.description ?? (discount.percent !== null ? `Discount (${discount.percent}%)` : "Discount"),
              quantity: 1,
              unitPrice: 0 - amount,
              lineTotal: 0 - amount,
              category: DISCOUNT_CATEGORY,
              discountPercent: discount.percent,
              sortOrder: lastOrder + 1,
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

    let lineCount = existing.lines.length;
    if (body.updateLines?.length || body.addLine || body.addDiscount || body.removeLineId || body.gstEnabled !== undefined) {
      const updatedLines = await db.clientInvoiceLine.findMany({ where: { invoiceId: params.id } });
      lineCount = updatedLines.length;
      if (invoiceGoesBelowZero(updatedLines, existing.kind)) return actionResult({ error: DISCOUNT_BELOW_ZERO_REFUSAL }, 409);
      subtotal = updatedLines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
      const breakdown = calculateShoppingAwareInvoiceTotals(updatedLines, gstEnabled, { kind: existing.kind });
      gstAmount = breakdown.gstAmount;
      totalAmount = breakdown.totalAmount;
    }
    const issuesDocument = body.status === "APPROVED" || body.status === "SENT" || body.status === "PAID" || body.status === "PART_PAID" || Boolean(body.recordPayment);
    if (issuesDocument && body.status !== existing.status) {
      const empty = emptyInvoiceRefusal({ lines: new Array(lineCount) });
      if (empty) return actionResult({ error: empty }, 409);
    }

    // A credit note may never credit more than its invoice has left: checked on
    // every content edit (an over-limit draft may only shrink) and again when
    // it is approved or sent, under the original invoice's row lock.
    if (existing.kind === "CREDIT_NOTE" && (editsContent || (issuesDocument && body.status !== existing.status))) {
      const limit = await creditLimitFor(db, existing);
      if (!limit) return actionResult({ error: "The invoice this credit note credits could not be found." }, 409);
      const refusal = creditNoteTotalRefusal({
        total: totalAmount,
        remaining: limit.remaining,
        originalNumber: limit.originalNumber,
        previousTotal: editsContent && !issuesDocument ? existing.totalAmount : undefined,
        requireCredit: issuesDocument,
      });
      if (refusal) return actionResult({ error: refusal }, 409);
    }

    // Wave D rule (owner-approved): a draft leaves DRAFT only when its job
    // lines all have a rate, no job is billed twice and its totals match its
    // lines, checked on the lines as they are now, under the client's lock.
    if (leavesDraft(existing.status, body.status, Boolean(body.recordPayment))) {
      const lines = await db.clientInvoiceLine.findMany({ where: { invoiceId: params.id } });
      const refusal = await approvalRuleRefusal(
        { ...existing, clientId: existing.clientId, lines, gstEnabled, totalAmount },
        db,
      );
      if (refusal) return actionResult({ error: refusal }, 409);
    }

    const statusData: Record<string, unknown> = {};
    if (body.status === ClientInvoiceStatus.PAID && existing.status !== ClientInvoiceStatus.PAID) {
      statusData.paidAt = new Date();
      // Direct status→PAID (legacy one-click flip): record the full amount as
      // settled so the paid figure is never left blank.
      if (existing.paidAmount == null) statusData.paidAmount = existing.totalAmount;
    }
    // sentAt is the FIRST time the invoice was sent ("Invoiced this month" and
    // the issued record read it); it is never restamped.
    if (body.status === ClientInvoiceStatus.SENT && existing.status !== ClientInvoiceStatus.SENT && !existing.sentAt) {
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
      // Approved or sent credit notes reduce what has to be paid to settle it.
      const credited = creditedAmountOf(
        await db.clientInvoice.findMany({ where: { creditsInvoiceId: params.id }, select: { status: true, totalAmount: true } }),
      );
      const fullySettled = newPaid + credited + 0.005 >= Number(existing.totalAmount ?? 0);
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
          recordedByName: xeroPayment
            ? (xeroPayment.trigger === "scheduled" ? SYSTEM_ACTOR_LABELS[SYSTEM_XERO_SYNC_ACTOR] : "Xero sync")
            : session.user.name || session.user.email || "Admin",
          receiptKey: rp.receiptKey?.trim() || null,
          ...(xeroPayment ? { source: "XERO", xeroPaymentId: xeroPayment.paymentId, trigger: xeroPayment.trigger } : {}),
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
      body.dueDate !== undefined || body.notes !== undefined || paymentLedger !== undefined || (editsContent && Boolean(readStartedWorkReview(existing.metadata)));
    const mergedMetadata = metadataChanged
      ? {
          ...((existing.metadata as object) ?? {}),
          ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(paymentLedger !== undefined ? { payments: paymentLedger } : {}),
          ...(editsContent && readStartedWorkReview(existing.metadata) ? { startedWorkReview: { ...readStartedWorkReview(existing.metadata)!, required: true } } : {}),
        }
      : undefined;

    // ── REVERSE ────────────────────────────────────────────────────────
    // Refused BEFORE anything is written, so a reversal that cannot happen
    // never half-applies alongside the line edits in the same request.
    if (body.reverse && (existing.paidAt || Number(existing.paidAmount ?? 0) > 0 || existing.xeroInvoiceId)) {
      return actionResult({ error: "This invoice has payment or Xero evidence. Reconcile a correction before changing it; reversing here would erase its settlement summary." }, 409);
    }
    if (body.reverse && !canReverseInvoice(existing.status)) {
      return actionResult(
        { error: reverseRefusalReason(existing.status) ?? "This invoice cannot be reversed." }, 409);
    }
    const reversing = Boolean(body.reverse) && canReverseInvoice(existing.status);
    if (reversing) {
      // Back to editable, with the settled stamps cleared: outstandingOf()
      // derives from paidAmount, so leaving them would show a reopened invoice
      // as still settled and hide every payment action on it.
      //
      // metadata.payments[] is deliberately KEPT. The money genuinely arrived;
      // what is being undone is the invoice's content, not its history, and an
      // admin reconciling a bank statement afterwards needs that ledger intact.
      statusData.paidAt = null;
      statusData.paidDate = null;
      statusData.paidAmount = null;
      statusData.paymentMethod = null;
      statusData.paymentReference = null;
      statusData.sentAt = null;
    }

    const effectiveStatus = reversing
      ? ClientInvoiceStatus.DRAFT
      : (paymentStatus ?? body.status);

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
    if (voiding && existing.kind === "CREDIT_NOTE") {
      const rebill = await creditNoteVoidRebillRefusal(db, existing);
      if (rebill) return actionResult({ error: rebill }, 409);
    }
    const statusChanges = Boolean(effectiveStatus) && effectiveStatus !== existing.status;
    // Issued documents keep the payment terms they were issued with.
    const termsSnapshot = statusChanges ? await termsSnapshotFor(db, existing, effectiveStatus) : undefined;

    const updated = await db.$transaction(async (tx) => {
      if (voiding) {
        released = await releaseInvoiceConsumables(tx, params.id);
      }
      const row = await tx.clientInvoice.update({
      where: { id: params.id },
      data: {
        ...(effectiveStatus ? { status: effectiveStatus } : {}),
        ...(body.status || reversing ? statusData : {}),
        ...paymentUpdate,
        ...(mergedMetadata !== undefined ? { metadata: mergedMetadata as any } : {}),
        ...(body.gstEnabled !== undefined ? { gstEnabled } : {}),
        ...(body.clientReference !== undefined ? { clientReference: body.clientReference || null } : {}),
        ...(body.clientNote !== undefined ? { clientNote: body.clientNote || null } : {}),
        ...(termsSnapshot !== undefined ? { paymentTermsDays: termsSnapshot } : {}),
        ...(draftFields?.ok ? draftFields.data : {}),
        subtotal,
        gstAmount,
        totalAmount,
      },
      });
      // One invoiced rule: a voided invoice stops billing its jobs, and a credit
      // note that now fully covers (or no longer covers) its invoice changes
      // whether that invoice bills its jobs.
      if (voiding && existing.kind === "INVOICE") {
        await returnInvoicedJobsToBillable(tx, {
          invoiceId: params.id,
          invoiceNumber: existing.invoiceNumber,
          reason: "voided",
          actorId: session.user.id,
        });
      }
      if (statusChanges && existing.kind === "CREDIT_NOTE" && existing.creditsInvoiceId) {
        await refreshCreditCoverage(tx, { invoiceId: existing.creditsInvoiceId, actorId: session.user.id });
      }
      if (draftFields?.ok && draftFields.summary.length) {
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: "CLIENT_INVOICE_DRAFT_FIELDS",
            entity: "ClientInvoice",
            entityId: params.id,
            before: { clientId: existing.clientId, periodStart: existing.periodStart?.toISOString() ?? null, periodEnd: existing.periodEnd?.toISOString() ?? null, paymentTermsDays: existing.paymentTermsDays },
            after: { summary: draftFields.summary.join("; "), warnings: draftFields.warnings },
          },
        });
      }
      return row;
    });

    // RECEIPT TO THE CLIENT. Recording a payment sent nothing at all before, so
    // a client who paid had no confirmation it had been applied and their next
    // statement was the first chance to find out it had not.
    //
    // After the write, best-effort: the money is already recorded, and failing
    // the response over a mail error would tell the admin the payment did not
    // save when it did.
    // A payment read from Xero gets the same receipt (owner decision
    // 2026-11-11), but the Xero sync sends it once it knows the invoice is not
    // left as "needs review" (client-invoice-xero-sync.ts), so it is not sent
    // from here.
    const receiptPayment = xeroPayment ? undefined : body.recordPayment;
    if (receiptPayment) {
      afterCommit.push(() => sendClientPaymentReceipt({
        invoiceId: params.id,
        amount: receiptPayment.amount,
        method: receiptPayment.method,
        paidDate: receiptPayment.paidDate ? new Date(receiptPayment.paidDate) : new Date(),
        reference: receiptPayment.reference ?? null,
      }).catch((err) =>
        logger.error(
          { err, invoiceId: params.id },
          "[invoice] payment recorded but the client receipt could not be sent"
        )
      ));
    }

    if (released) {
      logger.info(
        { invoiceId: params.id, ...(released as object) },
        "[invoice] voided; consumed items released for re-invoicing"
      );
    }

    // Reopening a settled invoice is a money correction, so it leaves a trail
    // naming who did it and what state it came from. Written AFTER the update,
    // like the override row above: a reversal that failed to apply must not
    // leave a log entry claiming it happened. Best-effort — the reversal is
    // already committed and failing the response now would tell the admin it
    // did not work when it did.
    if (reversing) {
      await db.auditLog
        .create({
          data: {
            userId: session.user.id,
            action: "CLIENT_INVOICE_REVERSED",
            entity: "ClientInvoice",
            entityId: params.id,
            after: {
              from: existing.status,
              to: ClientInvoiceStatus.DRAFT,
              invoiceNumber: existing.invoiceNumber,
              reason: body.reverse?.reason ?? null,
              // Named explicitly so the trail distinguishes this from a void:
              // the items stayed on this invoice.
              releasedItems: false,
            } as object,
          },
        })
        .catch((err) =>
          logger.error(
            { err, invoiceId: params.id },
            "[invoice] reversed but the audit entry could not be written"
          )
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
            ...(xeroPayment ? { source: "XERO", xeroPaymentId: xeroPayment.paymentId, trigger: xeroPayment.trigger, paidDate: (paymentUpdate as { paidDate?: Date }).paidDate?.toISOString() ?? null } : {}),
            // A scheduled check is recorded under an administrator account (the
            // row needs a user) but is the system's action, and shows as such.
            ...(xeroPayment?.trigger === "scheduled" ? systemActorMarker(SYSTEM_XERO_SYNC_ACTOR) : {}),
            ...(paidWithoutSending ? { note: "Marked paid without sending" } : {}),
          } as any,
        },
      });
    }

    return actionResult(draftFields?.ok && draftFields.warnings.length ? { ...updated, warnings: draftFields.warnings } : updated);
  } catch (err: any) {
    return actionResult({ error: err.message ?? "Could not update invoice." }, 400);
  }
}

type ExistingForXero = {
  id: string;
  kind: string;
  status: string;
  totalAmount: number;
  paidAmount: number | null;
  metadata: Prisma.JsonValue | null;
};

/**
 * The Xero-payment rules, checked under the row lock: only the sync may use
 * method XERO; a Xero payment id is recorded once; a PAID or VOID invoice is
 * never changed by the sync; and a Xero payment larger than what is still owed
 * (total less payments and approved/sent credits) is refused for review rather
 * than recorded.
 */
async function xeroPaymentRefusal(
  db: typeof import("@/lib/db").db,
  existing: ExistingForXero,
  body: z.infer<typeof patchSchema>,
  xeroPayment: XeroPaymentSource | undefined,
): Promise<InvoiceActionResult | null> {
  const viaXero = body.recordPayment?.method === "XERO";
  if (viaXero !== Boolean(xeroPayment)) {
    return actionResult({ error: "Payments made in Xero are recorded by Refresh from Xero, not by hand." }, 400);
  }
  if (!xeroPayment || !body.recordPayment) return null;
  if (existing.kind !== "INVOICE") return actionResult({ error: "A credit note is never paid." }, 409);
  const ledger = Array.isArray((existing.metadata as { payments?: unknown } | null)?.payments)
    ? ((existing.metadata as { payments: Array<Record<string, unknown>> }).payments)
    : [];
  if (ledger.some((entry) => entry && entry.xeroPaymentId === xeroPayment.paymentId)) {
    return actionResult({ ok: true, alreadyRecorded: true, status: existing.status });
  }
  if (existing.status === ClientInvoiceStatus.PAID || existing.status === ClientInvoiceStatus.VOID) {
    return actionResult({ error: `This invoice is ${existing.status.toLowerCase()} here, so the Xero payment was not recorded.` }, 409);
  }
  const credited = creditedAmountOf(
    await db.clientInvoice.findMany({ where: { creditsInvoiceId: existing.id }, select: { status: true, totalAmount: true } }),
  );
  const owing = Number(existing.totalAmount ?? 0) - Number(existing.paidAmount ?? 0) - credited;
  if (body.recordPayment.amount > owing + 0.005) {
    return actionResult({ error: "The Xero payment is more than this invoice still owes here.", code: XERO_PAYMENT_EXCEEDS_OWING }, 409);
  }
  return null;
}
