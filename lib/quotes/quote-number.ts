import "server-only";
/**
 * ISSUING THE NEXT QUOTE NUMBER.
 *
 * Same pattern as the invoice numbers (lib/billing/invoice-sequence.ts): one
 * row of `InvoiceSequence` (key "QUOTE", seeded by migration
 * 20261113030000_quote_reference_number after back-filling every existing
 * quote in creation order) and ONE atomic statement,
 * `UPDATE … SET "lastNumber" = "lastNumber" + 1 … RETURNING`. Two quotes
 * created at the same moment take the row lock in turn and get 204 and 205.
 *
 * Run it inside the transaction that creates the quote: if the quote fails to
 * save, the increment rolls back with it, so no number is ever attached to two
 * quotes and the counter never moves backwards. A deleted quote's number is
 * never issued again because the counter only counts up.
 *
 * Unlike invoices there is NO random fallback: `Quote.quoteNumber` is a unique
 * whole number, and inventing one would break the "never reused" promise. If
 * the counter cannot be read the quote is not created and the caller says so.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const QUOTE_SEQUENCE_KEY = "QUOTE";

type SequenceClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
type NumberRow = { lastNumber: number };

export class QuoteNumberUnavailableError extends Error {
  constructor() {
    super("The next quote number could not be issued. No quote was created; try again.");
    this.name = "QuoteNumberUnavailableError";
  }
}

async function takeNext(client: SequenceClient): Promise<number | null> {
  const rows = await client.$queryRaw<NumberRow[]>`
    UPDATE "InvoiceSequence"
       SET "lastNumber" = "lastNumber" + 1,
           "updatedAt"  = NOW()
     WHERE "key" = ${QUOTE_SEQUENCE_KEY}
    RETURNING "lastNumber"
  `;
  const value = rows?.[0] ? Number(rows[0].lastNumber) : null;
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Take the next quote number. Pass the transaction client that creates the
 * quote. A missing QUOTE row (a database seeded without the migration's row)
 * is created from the highest number already on file, then taken.
 */
export async function issueQuoteNumber(client: SequenceClient = db): Promise<number> {
  const first = await takeNext(client);
  if (first !== null) return first;
  await client.$executeRaw`
    INSERT INTO "InvoiceSequence" ("key", "prefix", "lastNumber", "padding", "updatedAt")
    SELECT ${QUOTE_SEQUENCE_KEY}, 'Q-', COALESCE(MAX("quoteNumber"), 0), 1, NOW() FROM "Quote"
    ON CONFLICT ("key") DO NOTHING
  `;
  const second = await takeNext(client);
  if (second === null) throw new QuoteNumberUnavailableError();
  return second;
}
