import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  normaliseSequenceInput,
  previewNextInvoiceNumber,
  type InvoiceSequenceKey,
} from "@/lib/billing/invoice-numbering";
import { readInvoiceSequences, setInvoiceSequence } from "@/lib/billing/invoice-sequence";

export const dynamic = "force-dynamic";

/**
 * WHERE THE INVOICE COUNTERS ARE SET.
 *
 * ADMIN ONLY, deliberately narrower than the settings page around it. The rest
 * of /v2/admin/settings admits OPS_MANAGER, but this endpoint decides what every
 * future invoice — money out AND money in — will be called, and can re-point the
 * counter at numbers already sitting on documents clients hold. That is the same
 * reason the pricebook and pay-rate surfaces are admin-gated: an OPS_MANAGER can
 * run the business day to day without ever needing to renumber its accounts.
 */

/** Both rails plus their rendered next number, for the settings screen. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
    const sequences = await readInvoiceSequences();
    return NextResponse.json({
      sequences,
      // Rendered server-side too so the screen and the next real invoice are
      // provably formatted by the same function, not by a UI re-implementation
      // that could drift from it.
      previews: {
        CLIENT: previewNextInvoiceNumber(sequences.CLIENT),
        CLEANER: previewNextInvoiceNumber(sequences.CLEANER),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not read the invoice sequences." },
      { status: statusFor(err?.message) }
    );
  }
}

/**
 * Move one rail.
 *
 * LOWERING `lastNumber` IS THE DANGEROUS CASE. The counter only ever hands out
 * "last + 1", so pulling it back means the next invoice carries a number that is
 * already printed on a document somebody has — two different invoices, same
 * reference, and a reconciliation that cannot be untangled afterwards. It is
 * still allowed, because correcting a typo'd starting number is a real need, but
 * it takes a second deliberate call carrying `confirmLowerNumber`. Blocking it
 * outright would leave a mistyped counter permanently wrong; allowing it quietly
 * would let a slip of the keyboard duplicate live invoice numbers.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
    }

    const key = (body as { key?: unknown }).key;
    if (key !== "CLIENT" && key !== "CLEANER") {
      return NextResponse.json(
        { error: 'Unknown sequence. Expected "CLIENT" or "CLEANER".' },
        { status: 400 }
      );
    }
    const sequenceKey: InvoiceSequenceKey = key;

    // Caught here because the validator coerces with Number(), and Number("")
    // is 0 — an admin who clears the field would otherwise be read as asking to
    // reset the counter to zero, which is the single most destructive value it
    // can take. An empty box means "unfinished", never "start again from 1".
    const rawLastNumber = (body as { lastNumber?: unknown }).lastNumber;
    if (rawLastNumber === null || (typeof rawLastNumber === "string" && rawLastNumber.trim() === "")) {
      return NextResponse.json(
        { error: "Enter the last invoice number that has already been issued." },
        { status: 400 }
      );
    }

    // The pure validator owns every rule about shape. Its message is returned
    // verbatim so the admin reads the same wording the rule was written in,
    // rather than a paraphrase that drifts as the rules change.
    const parsed = normaliseSequenceInput(body as Record<string, unknown>);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const current = await readInvoiceSequences();
    const before = current[sequenceKey];
    const next = parsed.value;

    const confirmLowerNumber = (body as { confirmLowerNumber?: unknown }).confirmLowerNumber === true;
    if (next.lastNumber < before.lastNumber && !confirmLowerNumber) {
      // 409, not 400: nothing the admin typed is invalid, the request simply
      // conflicts with numbers already issued. The UI needs the two figures to
      // name them in the warning it shows before asking again.
      return NextResponse.json(
        {
          error:
            `This sequence has already issued up to ${before.lastNumber}. ` +
            `Setting it back to ${next.lastNumber} will re-issue numbers that are already on sent invoices.`,
          requiresConfirmation: true,
          currentLastNumber: before.lastNumber,
          requestedLastNumber: next.lastNumber,
        },
        { status: 409 }
      );
    }

    await setInvoiceSequence(sequenceKey, next);

    // Renumbering is a money-document change, so it leaves a trace naming who
    // did it. Without this a duplicated invoice number is discoverable only by
    // noticing the duplicate, with no way back to when or by whom it was set.
    try {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          action: next.lastNumber < before.lastNumber ? "INVOICE_SEQUENCE_REWOUND" : "INVOICE_SEQUENCE_UPDATED",
          entity: "InvoiceSequence",
          entityId: sequenceKey,
          // Spelled out field by field rather than passing the objects: their
          // type is an `interface`, which Prisma's JSON input will not accept
          // without an index signature.
          before: { prefix: before.prefix, lastNumber: before.lastNumber, padding: before.padding },
          after: { prefix: next.prefix, lastNumber: next.lastNumber, padding: next.padding },
        },
      });
    } catch (auditErr) {
      // The setting is already saved; failing the response now would tell the
      // admin it did not save when it did. Logged loudly instead of swallowed.
      logger.error(
        { err: auditErr, key: sequenceKey },
        "[invoice-numbering] sequence saved but the audit entry could not be written"
      );
    }

    return NextResponse.json({
      sequence: next,
      preview: previewNextInvoiceNumber(next),
    });
  } catch (err: any) {
    logger.error({ err }, "[invoice-numbering] could not save the sequence");
    return NextResponse.json(
      { error: err?.message ?? "Could not save the invoice sequence." },
      { status: statusFor(err?.message) }
    );
  }
}

function statusFor(message: string | undefined): number {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "FORBIDDEN") return 403;
  return 400;
}
