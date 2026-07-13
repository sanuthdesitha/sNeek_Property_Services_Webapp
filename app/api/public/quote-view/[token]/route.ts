import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordQuoteEvent } from "@/lib/quotes/events";
import { buildPublicQuotePayload, findQuoteByToken } from "../_lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Public, token-scoped quote view. Client-safe payload only. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const quote = await findQuoteByToken(params.token);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }

    // Stamp first-view time atomically; the affected-row count tells us this is
    // the FIRST view (null → now), so the VIEWED event is recorded exactly once
    // and never re-fires on subsequent page loads.
    const firstView = await db.quote.updateMany({
      where: { id: quote.id, viewedAt: null },
      data: { viewedAt: new Date() },
    });
    if (firstView.count > 0) {
      await recordQuoteEvent(quote.id, "VIEWED");
    }

    const payload = await buildPublicQuotePayload(quote);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Could not load the quote." }, { status: 500 });
  }
}
