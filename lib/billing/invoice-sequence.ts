/**
 * ISSUING THE NEXT INVOICE NUMBER.
 *
 * The formatting rules are pure and live in ./invoice-numbering. This module is
 * the one part that has to touch the database, because handing out a number is
 * the one part that has to be atomic.
 *
 * ONE STATEMENT, NO LOCK. `UPDATE … SET "lastNumber" = "lastNumber" + 1 …
 * RETURNING` is atomic in Postgres by itself: two invoices generated in the same
 * millisecond take the row lock in turn and get 41 and 42. A read-then-write —
 * or a counter kept in the settings JSON — would hand both of them 41, and the
 * second would die on the UNIQUE constraint halfway through building an invoice.
 *
 * IT NEVER FAILS THE INVOICE. If the table is missing because a migration has
 * not run yet, or the statement errors for any other reason, the caller gets the
 * old random-suffix name and a loud log line. Losing the sequence is a numbering
 * problem that can be corrected afterwards; failing to invoice is a cash-flow
 * problem that cannot.
 *
 * NUMBERS ARE ISSUED, NOT RESERVED. A number is consumed the moment it is handed
 * out, even if the invoice it was for then fails to save. That leaves a gap, and
 * a gap is the correct outcome: re-using the number would mean two different
 * documents could carry it, which is the one thing a sequence exists to prevent.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  DEFAULT_SEQUENCES,
  formatInvoiceNumber,
  legacyFallbackNumber,
  type InvoiceSequenceKey,
  type InvoiceSequenceShape,
} from "@/lib/billing/invoice-numbering";

type SequenceRow = { prefix: string; lastNumber: number; padding: number };

/**
 * Take the next number on a sequence.
 *
 * Returns the formatted string, and always returns something — see the note
 * above about never failing the invoice.
 */
export async function issueInvoiceNumber(key: InvoiceSequenceKey): Promise<string> {
  try {
    const rows = await db.$queryRaw<SequenceRow[]>`
      UPDATE "InvoiceSequence"
         SET "lastNumber" = "lastNumber" + 1,
             "updatedAt"  = NOW()
       WHERE "key" = ${key}
      RETURNING "prefix", "lastNumber", "padding"
    `;

    const row = rows?.[0];
    if (!row) {
      // The table exists but this rail has no row — a partially-seeded
      // database. Create it at 1 rather than falling back, so numbering starts
      // working now instead of at the next deploy.
      const seeded = await seedAndTake(key);
      if (seeded) return seeded;
      logger.error({ key }, "[invoice-number] no sequence row; using the legacy format");
      return legacyFallbackNumber(new Date(), randomUUID());
    }

    return formatInvoiceNumber(
      { prefix: row.prefix, lastNumber: Number(row.lastNumber), padding: Number(row.padding) },
      Number(row.lastNumber)
    );
  } catch (err) {
    logger.error(
      { err, key },
      "[invoice-number] could not take the next number; falling back to the legacy format. " +
        "The invoice is still issued — check that migration 20260823120000_invoice_sequence has run."
    );
    return legacyFallbackNumber(new Date(), randomUUID());
  }
}

/** Create a missing rail at 1 and return that first number. */
async function seedAndTake(key: InvoiceSequenceKey): Promise<string | null> {
  try {
    const defaults = DEFAULT_SEQUENCES[key];
    await db.invoiceSequence.create({
      data: { key, prefix: defaults.prefix, lastNumber: 1, padding: defaults.padding },
    });
    return formatInvoiceNumber(defaults, 1);
  } catch {
    return null;
  }
}

/**
 * Both sequences as they currently stand, for the settings screen.
 *
 * Falls back to the defaults rather than throwing: a settings page that will not
 * render is a worse answer than one showing that numbering is not set up yet.
 */
export async function readInvoiceSequences(): Promise<
  Record<InvoiceSequenceKey, InvoiceSequenceShape>
> {
  try {
    const rows = await db.invoiceSequence.findMany({
      select: { key: true, prefix: true, lastNumber: true, padding: true },
    });
    const out = { ...DEFAULT_SEQUENCES };
    for (const row of rows) {
      if (row.key === "CLIENT" || row.key === "CLEANER") {
        out[row.key] = { prefix: row.prefix, lastNumber: row.lastNumber, padding: row.padding };
      }
    }
    return out;
  } catch (err) {
    logger.error({ err }, "[invoice-number] could not read the sequences");
    return { ...DEFAULT_SEQUENCES };
  }
}

/**
 * Set where a sequence continues from.
 *
 * The caller is expected to have validated with `normaliseSequenceInput` first;
 * this writes what it is given. Moving a counter BACKWARDS is allowed — the
 * owner may genuinely need to correct a mistake — but it is the caller's job to
 * warn them, because the consequence is re-issuing a number that is already on a
 * document somebody has.
 */
export async function setInvoiceSequence(
  key: InvoiceSequenceKey,
  value: InvoiceSequenceShape
): Promise<void> {
  await db.invoiceSequence.upsert({
    where: { key },
    create: { key, prefix: value.prefix, lastNumber: value.lastNumber, padding: value.padding },
    update: { prefix: value.prefix, lastNumber: value.lastNumber, padding: value.padding },
  });
}
