import { NextRequest, NextResponse } from "next/server";
import { QuoteStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { calculateGstBreakdown } from "@/lib/pricing/gst";
import { recordQuoteEvent } from "@/lib/quotes/events";
import {
  addExtrasToNotesMeta,
  parseRequestedAddOns,
  removeRequestedAddOns,
  type QuoteLineItem,
  type RequestedAddOn,
} from "@/lib/quotes/requested-addons";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["accept", "dismiss"]),
  items: z
    .array(
      z.object({
        id: z.string().trim().max(80).optional(),
        label: z.string().trim().min(1).max(120),
        // Admin may override the price when accepting; ignored on dismiss.
        price: z.number().min(0).max(100000).optional(),
      })
    )
    .min(1)
    .max(30),
});

function parseLineItems(raw: unknown): QuoteLineItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QuoteLineItem[] = [];
  for (const item of raw) {
    const e = (item ?? {}) as Record<string, unknown>;
    const label = String(e.label ?? "").trim();
    if (!label) continue;
    out.push({
      label: label.slice(0, 300),
      unitPrice: Number(e.unitPrice) || 0,
      qty: Number(e.qty) || 0,
      total: Number(e.total) || 0,
    });
  }
  return out;
}

/** GET — the current pending requested add-ons for this quote. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const quote = await db.quote.findUnique({
      where: { id: params.id },
      select: { requestedAddOns: true },
    });
    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    return NextResponse.json(
      { requestedAddOns: parseRequestedAddOns(quote.requestedAddOns) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/**
 * POST — accept requested add-ons into the quote's pricing (+ extras that flow
 * to the job), or dismiss them. Both clear the entries from the pending list.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const quote = await db.quote.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        notes: true,
        lineItems: true,
        requestedAddOns: true,
      },
    });
    if (!quote) return NextResponse.json({ error: "Quote not found." }, { status: 404 });

    const pending = parseRequestedAddOns(quote.requestedAddOns);
    const remaining = removeRequestedAddOns(pending, body.items);

    if (body.action === "dismiss") {
      const updated = await db.quote.update({
        where: { id: quote.id },
        data: { requestedAddOns: remaining as unknown as object },
        select: { requestedAddOns: true },
      });
      await recordQuoteEvent(quote.id, "NOTE", {
        note: `Dismissed add-on request: ${body.items.map((i) => i.label).join(", ")}`,
      });
      return NextResponse.json({
        ok: true,
        requestedAddOns: parseRequestedAddOns(updated.requestedAddOns),
      });
    }

    // ── accept: price the add-ons into the quote ─────────────────────────────
    if (quote.status === QuoteStatus.CONVERTED) {
      return NextResponse.json(
        { error: "This quote has been converted to a job and can no longer be edited." },
        { status: 400 }
      );
    }

    // Resolve the accepted entries — prefer the admin-supplied price, else the
    // price captured on the original pending request.
    const accepted: RequestedAddOn[] = body.items.map((i) => {
      const match = pending.find(
        (p) => (i.id && p.id === i.id) || p.label.trim().toLowerCase() === i.label.trim().toLowerCase()
      );
      const price = i.price ?? match?.price ?? 0;
      return { id: i.id ?? match?.id, label: i.label, price: Math.max(0, price) };
    });

    const lineItems = parseLineItems(quote.lineItems);
    for (const add of accepted) {
      lineItems.push({ label: add.label, unitPrice: add.price, qty: 1, total: add.price });
    }
    const newSubtotal = lineItems.reduce((sum, li) => sum + (Number(li.total) || 0), 0);

    const settings = await getAppSettings();
    const totals = calculateGstBreakdown(newSubtotal, { gstEnabled: settings.pricing.gstEnabled });

    const nextNotes = addExtrasToNotesMeta(quote.notes, accepted);

    const updated = await db.quote.update({
      where: { id: quote.id },
      data: {
        lineItems: lineItems as unknown as object,
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        totalAmount: totals.totalAmount,
        notes: nextNotes,
        requestedAddOns: remaining as unknown as object,
      },
      select: {
        lineItems: true,
        subtotal: true,
        gstAmount: true,
        totalAmount: true,
        notes: true,
        requestedAddOns: true,
      },
    });

    await recordQuoteEvent(quote.id, "NOTE", {
      note: `Added requested add-ons to quote: ${accepted
        .map((a) => `${a.label} ($${a.price.toFixed(2)})`)
        .join(", ")}`,
    });

    return NextResponse.json({
      ok: true,
      lineItems: parseLineItems(updated.lineItems),
      subtotal: updated.subtotal,
      gstAmount: updated.gstAmount,
      totalAmount: updated.totalAmount,
      notes: updated.notes,
      requestedAddOns: parseRequestedAddOns(updated.requestedAddOns),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
