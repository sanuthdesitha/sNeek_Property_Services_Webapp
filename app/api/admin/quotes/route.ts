import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createQuoteSchema } from "@/lib/validations/quote";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { QuoteReferenceError, assertQuoteReferenceKeys, caseForQuote, linkQuoteToCase } from "@/lib/cases/repair-quote";
import { QuoteNumberUnavailableError, issueQuoteNumber } from "@/lib/quotes/quote-number";
import { QUOTE_INTERNAL_NOTES_AUDIT } from "@/lib/quotes/quote-patch-write";

/**
 * Warn (never block) when a quote's net price falls below the configured margin
 * floor — the admin path is "warn but allow" (the public path auto-clamps).
 * Uses the same model as the pricing calculator's margin-floor guard: cost is
 * `positiveSubtotal × costShare`, and the floor price is `cost / (1 - floor%)`.
 * Discounts show up as negative line items, so `positiveSubtotal` is the price
 * before discounts and `netSubtotal` is what's actually charged.
 */
async function computeMarginFloorWarning(
  lineItems: Array<{ total?: number | null }> | undefined,
  netSubtotal: number
): Promise<string | null> {
  const pricing = (await getAppSettings()).pricing;
  const costShare =
    pricing.rackHourlyRate > 0
      ? Math.min(0.95, pricing.cleanerHourlyCost / pricing.rackHourlyRate)
      : 0;
  if (costShare <= 0) return null;
  const positiveSubtotal = (lineItems ?? []).reduce(
    (sum, li) => sum + Math.max(0, Number(li?.total ?? 0)),
    0
  );
  if (positiveSubtotal <= 0) return null;
  const floorPct = pricing.marginFloorPercent ?? 40;
  const floorDivisor = Math.max(0.05, 1 - floorPct / 100);
  const floorPrice = Number(((positiveSubtotal * costShare) / floorDivisor).toFixed(2));
  if (netSubtotal >= floorPrice) return null;
  return `This quote's price ($${netSubtotal.toFixed(
    2
  )}) is below the ${floorPct}% margin floor (min $${floorPrice.toFixed(
    2
  )}). Sending anyway.`;
}

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const quotes = await db.quote.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true, email: true } },
        lead: { select: { name: true, email: true } },
      },
    });
    return NextResponse.json(quotes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { newLead, fromCaseId, ...quoteData } = createQuoteSchema.parse(await req.json());
    // A quote started from a case: the case must still exist (re-checked here,
    // not trusted from the page), and reference images must be the case's own
    // evidence or uploads the caller may attach.
    const linkedCase = fromCaseId ? await caseForQuote(fromCaseId) : null;
    await assertQuoteReferenceKeys({ keys: (quoteData.referenceImages ?? []).map((image) => image.key), callerId: session.user.id, caseId: linkedCase?.id ?? null });

    let leadId = quoteData.leadId;
    // A brand-new recipient with their details → create the lead, link it.
    if (newLead) {
      const lead = await db.quoteLead.create({
        data: {
          name: newLead.name,
          email: newLead.email.toLowerCase(),
          phone: newLead.phone || null,
          suburb: newLead.suburb || null,
          serviceType: quoteData.serviceType,
          status: "QUOTED",
        },
      });
      leadId = lead.id;
    }

    // The reference number is taken in the same transaction as the quote, so a
    // failed save never consumes or duplicates a number.
    const quote = await db.$transaction(async (tx) => {
      const quoteNumber = await issueQuoteNumber(tx);
      const created = await tx.quote.create({ data: { ...quoteData, internalNotes: quoteData.internalNotes || null, leadId, quoteNumber } });
      if (created.internalNotes) {
        await tx.auditLog.create({
          data: { userId: session.user.id, action: QUOTE_INTERNAL_NOTES_AUDIT, entity: "Quote", entityId: created.id, before: { internalNotes: null }, after: { internalNotes: created.internalNotes } },
        });
      }
      if (linkedCase) {
        await linkQuoteToCase(tx, { quoteId: created.id, quoteNumber: created.quoteNumber, caseId: linkedCase.id, caseTitle: linkedCase.title, actorId: session.user.id });
      }
      return created;
    });
    const marginWarning = await computeMarginFloorWarning(
      quoteData.lineItems as Array<{ total?: number | null }> | undefined,
      Number(quoteData.subtotal ?? 0)
    );
    return NextResponse.json(
      marginWarning ? { ...quote, marginWarning } : quote,
      { status: 201 }
    );
  } catch (err: any) {
    if (err instanceof QuoteReferenceError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof QuoteNumberUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Check the quote." }, { status: 400 });
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
