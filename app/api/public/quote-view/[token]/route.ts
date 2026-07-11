import { NextRequest, NextResponse } from "next/server";
import {
  buildPublicQuotePayload,
  findQuoteByToken,
  stampViewedAt,
} from "../_lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Public, token-scoped quote view. Client-safe payload only. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const quote = await findQuoteByToken(params.token);
    if (!quote) {
      return NextResponse.json({ error: "Quote not found." }, { status: 404 });
    }

    await stampViewedAt(quote.id);
    const payload = await buildPublicQuotePayload(quote);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Could not load the quote." }, { status: 500 });
  }
}
