/**
 * The quote page's facts row (Total, Valid until, Client opened, Pricing,
 * Requested by client), from stored facts and the builder's live totals.
 * Unknown stays unknown ("Not recorded"). Plain module.
 */
import type { EPillTone } from "@/components/v2/ui/pill";
import { PRICING_SOURCE_BADGE, money, type PricingSource } from "../builder/model";
import type { MarginCheck } from "../builder/margin";
import { daysUntil, formatCalendarDay, formatOrgDate } from "./format";

export type FactInput = {
  totalIncGst: number;
  gstEnabled: boolean;
  validUntilDay: string;
  viewedAt: string | null;
  isNew: boolean;
  pricingSource: PricingSource;
  margin: MarginCheck;
  requestedCount: number;
  timezone: string;
  now?: Date;
};

export type FactRow = { key: string; label: string; value: string; muted?: boolean; note?: string; pill?: { label: string; tone: EPillTone } };

function validNote(day: string, timezone: string, now?: Date): string | undefined {
  const days = daysUntil(day, timezone, now);
  if (days == null) return undefined;
  if (days < 0) return "expired";
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function quoteFacts(input: FactInput): FactRow[] {
  const marginTone: EPillTone = input.margin.state === "below" ? "bad" : input.margin.state === "ok" ? "ok" : "neutral";
  return [
    { key: "total", label: "Total", value: money(input.totalIncGst), note: input.gstEnabled ? "inc GST" : "GST not applied" },
    input.validUntilDay
      ? { key: "valid", label: "Valid until", value: formatCalendarDay(input.validUntilDay), note: validNote(input.validUntilDay, input.timezone, input.now) }
      : { key: "valid", label: "Valid until", value: "No date set", muted: true },
    input.isNew
      ? { key: "opened", label: "Client opened", value: "Not sent yet", muted: true }
      : input.viewedAt
        ? { key: "opened", label: "Client opened", value: formatOrgDate(input.viewedAt, input.timezone) }
        : { key: "opened", label: "Client opened", value: "Not recorded", muted: true },
    { key: "pricing", label: "Pricing", value: PRICING_SOURCE_BADGE[input.pricingSource].label, muted: input.pricingSource === "unknown", pill: { label: input.margin.label, tone: marginTone } },
    input.requestedCount > 0
      ? { key: "requested", label: "Requested by client", value: `${input.requestedCount} add-on${input.requestedCount === 1 ? "" : "s"}`, pill: { label: "Decide", tone: "warn" } }
      : { key: "requested", label: "Requested by client", value: "None", muted: true },
  ];
}
