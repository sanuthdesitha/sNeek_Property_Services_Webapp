import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { recordQuoteEvent } from "@/lib/quotes/events";
import {
  buildPublicQuotePayload,
  findQuoteByToken,
} from "@/app/api/public/quote-view/_lib";
import { QuoteView } from "./quote-view";

// The page must always reflect the LATEST saved quote — admin edits show up
// live on refresh. Never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const quote = await findQuoteByToken(params.token);
  if (!quote) return { title: "Quote", robots: { index: false, follow: false } };
  const payload = await buildPublicQuotePayload(quote);
  return {
    title: `${payload.serviceLabel} Quote — ${payload.company.name}`,
    robots: { index: false, follow: false },
  };
}

export default async function PublicQuotePage({ params }: { params: { token: string } }) {
  const quote = await findQuoteByToken(params.token);
  if (!quote) notFound();

  // Record the VIEWED event on the first view only (null → now transition),
  // guarded by the atomic affected-row count so page reloads don't spam events.
  const firstView = await db.quote.updateMany({
    where: { id: quote.id, viewedAt: null },
    data: { viewedAt: new Date() },
  });
  if (firstView.count > 0) {
    await recordQuoteEvent(quote.id, "VIEWED");
  }

  const payload = await buildPublicQuotePayload(quote);

  return <QuoteView token={params.token} quote={payload} />;
}
