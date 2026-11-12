import "server-only";
/**
 * The quote PATCH's write, with the stale-write guard and the office-notes
 * audit in one transaction.
 *
 * With `expectedUpdatedAt` the row is only written while it is still that
 * version (`updateMany … where updatedAt = stored`, which PostgreSQL re-checks
 * under the row lock), so two saves that read the same version cannot both
 * land. Without it the write is the plain update the route always did.
 *
 * A change to `internalNotes` writes an AuditLog row (QUOTE_INTERNAL_NOTES_UPDATED)
 * with the before and after text in the same transaction, so the audit never
 * claims a change that was rolled back.
 */
import type { Prisma, Quote } from "@prisma/client";
import { db } from "@/lib/db";
import { isStaleQuoteWrite, staleQuoteBody, type StaleQuoteBody } from "./quote-stale-guard";

export const QUOTE_INTERNAL_NOTES_AUDIT = "QUOTE_INTERNAL_NOTES_UPDATED";

export type QuotePatchWriteInput = {
  quoteId: string;
  actorId: string;
  data: Prisma.QuoteUncheckedUpdateManyInput;
  expectedUpdatedAt: string | undefined;
};

export type QuotePatchWriteResult =
  | { kind: "ok"; quote: Quote }
  | { kind: "missing" }
  | { kind: "stale"; body: StaleQuoteBody };

function notesChanged(before: string | null, data: Prisma.QuoteUncheckedUpdateManyInput): data is Prisma.QuoteUncheckedUpdateManyInput & { internalNotes: string | null } {
  if (!("internalNotes" in data)) return false;
  const after = data.internalNotes;
  return (typeof after === "string" || after === null) && (after ?? null) !== (before ?? null);
}

export async function writeQuotePatch(input: QuotePatchWriteInput): Promise<QuotePatchWriteResult> {
  const { quoteId, actorId, data, expectedUpdatedAt } = input;
  return db.$transaction(async (tx) => {
    const current = await tx.quote.findUnique({ where: { id: quoteId }, select: { updatedAt: true, internalNotes: true } });
    if (!current) return { kind: "missing" as const };
    if (isStaleQuoteWrite(current.updatedAt, expectedUpdatedAt)) return { kind: "stale" as const, body: staleQuoteBody(current.updatedAt) };

    let quote: Quote;
    if (expectedUpdatedAt !== undefined) {
      const written = await tx.quote.updateMany({ where: { id: quoteId, updatedAt: current.updatedAt }, data });
      if (written.count === 0) {
        // Another write landed between the read and this one: nothing was written.
        const latest = await tx.quote.findUnique({ where: { id: quoteId }, select: { updatedAt: true } });
        if (!latest) return { kind: "missing" as const };
        return { kind: "stale" as const, body: staleQuoteBody(latest.updatedAt) };
      }
      quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    } else {
      quote = await tx.quote.update({ where: { id: quoteId }, data });
    }

    if (notesChanged(current.internalNotes, data)) {
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: QUOTE_INTERNAL_NOTES_AUDIT,
          entity: "Quote",
          entityId: quoteId,
          before: { internalNotes: current.internalNotes ?? null },
          after: { internalNotes: data.internalNotes ?? null },
        },
      });
    }
    return { kind: "ok" as const, quote };
  });
}
