/**
 * Per-campaign email analytics, aggregated from EmailCampaignEvent rows that
 * app/api/webhooks/resend writes.
 *
 * `sent` comes from the CampaignSend ledger (what we actually handed to the
 * provider), not from the event stream — Resend's `email.sent` event is not
 * guaranteed to arrive, and the ledger is the number we are certain about.
 * Every other metric counts DISTINCT recipients per event type, so a mail client
 * that fires five open-pixel requests still counts as one open.
 */
import { db } from "@/lib/db";

export type CampaignEventType =
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "COMPLAINED"
  | "DELAYED";

export type CampaignStats = {
  campaignId: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  /** Rates as 0–1 fractions against `sent` (delivered) / `delivered` (the rest). */
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  complaintRate: number;
};

function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.min(1, numerator / denominator);
}

function emptyStats(campaignId: string): CampaignStats {
  return {
    campaignId,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    deliveryRate: 0,
    openRate: 0,
    clickRate: 0,
    bounceRate: 0,
    complaintRate: 0,
  };
}

/** Build the stats object from raw distinct-recipient counts. */
export function buildCampaignStats(input: {
  campaignId: string;
  sent: number;
  distinctByType: Partial<Record<CampaignEventType, number>>;
}): CampaignStats {
  const sent = input.sent;
  const delivered = input.distinctByType.DELIVERED ?? 0;
  const opened = input.distinctByType.OPENED ?? 0;
  const clicked = input.distinctByType.CLICKED ?? 0;
  const bounced = input.distinctByType.BOUNCED ?? 0;
  const complained = input.distinctByType.COMPLAINED ?? 0;
  // Opens/clicks can only be attributed to mail that landed. If no delivered
  // events have arrived yet (provider not configured for them), fall back to
  // `sent` so the rates are still meaningful rather than a hard 0.
  const openBase = delivered || sent;

  return {
    campaignId: input.campaignId,
    sent,
    delivered,
    opened,
    clicked,
    bounced,
    complained,
    deliveryRate: rate(delivered, sent),
    openRate: rate(opened, openBase),
    clickRate: rate(clicked, openBase),
    bounceRate: rate(bounced, sent),
    complaintRate: rate(complained, sent),
  };
}

/** Stats for many campaigns in two queries (no N+1 per campaign row). */
export async function getCampaignStats(campaignIds: string[]): Promise<Record<string, CampaignStats>> {
  const ids = Array.from(new Set(campaignIds.filter(Boolean)));
  if (ids.length === 0) return {};

  const [sends, events] = await Promise.all([
    (db as any).campaignSend.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: ids }, status: "SENT" },
      _count: { _all: true },
    }) as Promise<Array<{ campaignId: string; _count: { _all: number } }>>,
    (db as any).emailCampaignEvent.findMany({
      where: { campaignId: { in: ids } },
      select: { campaignId: true, recipient: true, type: true },
    }) as Promise<Array<{ campaignId: string; recipient: string; type: string }>>,
  ]);

  const sentByCampaign = new Map<string, number>(
    sends.map((row) => [row.campaignId, row._count._all]),
  );

  // campaignId -> type -> Set(recipient)
  const distinct = new Map<string, Map<string, Set<string>>>();
  for (const event of events) {
    let byType = distinct.get(event.campaignId);
    if (!byType) {
      byType = new Map();
      distinct.set(event.campaignId, byType);
    }
    let set = byType.get(event.type);
    if (!set) {
      set = new Set();
      byType.set(event.type, set);
    }
    set.add(event.recipient.toLowerCase());
  }

  const result: Record<string, CampaignStats> = {};
  for (const id of ids) {
    const byType = distinct.get(id);
    const counts: Partial<Record<CampaignEventType, number>> = {};
    if (byType) {
      for (const [type, set] of Array.from(byType.entries())) counts[type as CampaignEventType] = set.size;
    }
    const sent = sentByCampaign.get(id) ?? 0;
    result[id] = sent === 0 && !byType ? emptyStats(id) : buildCampaignStats({ campaignId: id, sent, distinctByType: counts });
  }
  return result;
}
