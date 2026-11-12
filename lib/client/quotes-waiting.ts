import "server-only";
import { QuoteStatus } from "@prisma/client";
import { db } from "@/lib/db";
import type { QuoteWaiting } from "@/components/v2/client/approvals/quote-decision-card";

/**
 * Issued quotes still waiting for this client's decision (SENT), for the
 * Approvals list and the dashboard. The same rows and fields My quotes already
 * shows the client; deliberately does NOT mark them viewed (only opening My
 * quotes does), so the office's "viewed" signal keeps its meaning.
 */
export async function listQuotesWaiting(clientId: string, now = new Date()): Promise<QuoteWaiting[]> {
  const rows = await db.quote.findMany({
    where: { clientId, status: QuoteStatus.SENT },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, serviceType: true, totalAmount: true, validUntil: true, createdAt: true },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    serviceType: String(row.serviceType),
    totalAmount: Number(row.totalAmount ?? 0),
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    expired: Boolean(row.validUntil && row.validUntil.getTime() < now.getTime()),
  }));
}
