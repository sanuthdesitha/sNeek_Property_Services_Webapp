/**
 * Money step (c) rules the client-invoice PATCH applies on top of its original
 * guards: what counts as a content edit, the per-kind line sign rules, the
 * discount lock, the credit-note limit and the server-side PIN check for
 * removing a line. Kept apart from client-invoice-patch.ts so that file only
 * wires them in.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { creditedAmountOf } from "@/lib/finance/receivables";
import {
  CREDIT_NOTE_PAYMENT_REFUSAL,
  DISCOUNT_AMOUNT_LOCKED_REFUSAL,
  DISCOUNT_ON_CREDIT_NOTE_REFUSAL,
  creditableRemaining,
  isDiscountLine,
} from "./client-invoice-adjustments";
import { actionResult, type InvoiceActionResult, type InvoiceActor } from "./invoice-action-result";

export const securitySchema = z
  .object({ pin: z.string().max(200).optional(), password: z.string().max(500).optional() })
  .optional();

export const addDiscountSchema = z.object({
  description: z.string().trim().min(1).max(500).optional(),
  amount: z.number().positive().max(10_000_000).optional(),
  percent: z.number().positive().max(100).optional(),
});

/** Fields of the PATCH body these rules read. */
export type ContentEditBody = {
  status?: string;
  recordPayment?: unknown;
  updateLines?: Array<{ id: string; quantity?: number; unitPrice?: number; propertyId?: string | null }>;
  addLine?: { unitPrice: number };
  addDiscount?: unknown;
  removeLineId?: string;
  reorderLineIds?: string[];
  gstEnabled?: boolean;
  clientReference?: string | null;
  clientNote?: string | null;
};

/** Anything that changes what the document says or adds up to. */
export function contentEditRequested(body: ContentEditBody): boolean {
  return Boolean(
    body.updateLines?.length ||
      body.addLine ||
      body.addDiscount ||
      body.removeLineId ||
      body.reorderLineIds?.length ||
      body.gstEnabled !== undefined ||
      body.clientReference !== undefined ||
      body.clientNote !== undefined,
  );
}

type RuleLine = { id: string; category: string };
type RuleInvoice = { kind: string; lines: RuleLine[] };

function refused(error: string, status = 400): InvoiceActionResult {
  return actionResult({ error }, status);
}

/**
 * Line sign and kind rules. An invoice's ordinary lines are charges (price
 * zero or more); a credit note's are credits (price zero or less). A discount
 * keeps the amount it was given; a credit note takes no discount; a credit
 * note is never paid.
 */
export function kindRuleRefusal(invoice: RuleInvoice, body: ContentEditBody): InvoiceActionResult | null {
  const creditNote = invoice.kind === "CREDIT_NOTE";
  if (creditNote && (body.recordPayment || body.status === "PAID" || body.status === "PART_PAID")) {
    return refused(CREDIT_NOTE_PAYMENT_REFUSAL, 409);
  }
  if (creditNote && body.addDiscount) return refused(DISCOUNT_ON_CREDIT_NOTE_REFUSAL);
  if (body.addLine) {
    const price = body.addLine.unitPrice;
    if (!creditNote && price < 0) return refused("A charge must be zero or more. Use Add discount to take money off.");
    if (creditNote && price > 0) return refused("A credit note line must be zero or less.");
  }
  for (const update of body.updateLines ?? []) {
    const line = invoice.lines.find((candidate) => candidate.id === update.id);
    if (!line) continue; // The update itself reports a missing line.
    if (isDiscountLine(line)) {
      if (update.quantity !== undefined || update.unitPrice !== undefined) return refused(DISCOUNT_AMOUNT_LOCKED_REFUSAL);
      continue;
    }
    if (update.unitPrice === undefined) continue;
    if (!creditNote && update.unitPrice < 0) return refused("A charge must be zero or more. Use Add discount to take money off.");
    if (creditNote && update.unitPrice > 0) return refused("A credit note line must be zero or less.");
  }
  return null;
}

type CreditClient = Pick<Prisma.TransactionClient, "clientInvoice" | "$queryRaw">;

export type CreditLimit = { remaining: number; originalNumber: string };

/**
 * How much the credited invoice still has left to credit, excluding this
 * credit note itself. The original's row is locked first, so two credit notes
 * approved at the same moment cannot both pass on the same remainder.
 */
export async function creditLimitFor(
  client: CreditClient,
  creditNote: { id: string; creditsInvoiceId: string | null },
): Promise<CreditLimit | null> {
  if (!creditNote.creditsInvoiceId) return null;
  await client.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${creditNote.creditsInvoiceId} FOR UPDATE`;
  const original = await client.clientInvoice.findUnique({
    where: { id: creditNote.creditsInvoiceId },
    select: {
      invoiceNumber: true,
      totalAmount: true,
      creditNotes: { where: { id: { not: creditNote.id } }, select: { status: true, totalAmount: true } },
    },
  });
  if (!original) return null;
  return {
    remaining: creditableRemaining(original.totalAmount, creditedAmountOf(original.creditNotes)),
    originalNumber: original.invoiceNumber,
  };
}

/** The code verifySensitiveAction throws for a missing or wrong credential. */
const SECURITY_REFUSALS = new Set(["INVALID_SECURITY_VERIFICATION", "PIN_OR_PASSWORD_REQUIRED"]);

/**
 * Verify the administrator PIN or password ON THE SERVER for a destructive
 * invoice action (removing a line, deleting an invoice). Uses the shared
 * verification (bcrypt comparison); the credential is never logged or stored.
 * Refused while impersonating: the credential would be checked against the
 * impersonated account, not the person at the keyboard. Same shape as the
 * user and form-template deletes: `{ error: CODE }` with status 423.
 */
export async function verifyInvoiceSecurity(
  actor: InvoiceActor,
  security: { pin?: string; password?: string } | null | undefined,
): Promise<InvoiceActionResult | null> {
  if (actor.impersonatedBy) return refused("FORBIDDEN", 403);
  try {
    await verifySensitiveAction(actor.id, security ?? null);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "INVALID_SECURITY_VERIFICATION";
    if (SECURITY_REFUSALS.has(message)) return refused(message, 423);
    if (message === "UNAUTHORIZED") return refused(message, 401);
    if (message === "FORBIDDEN") return refused(message, 403);
    return refused("INVALID_SECURITY_VERIFICATION", 423);
  }
}
