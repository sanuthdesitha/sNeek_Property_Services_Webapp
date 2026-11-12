/** Tabs of the Quotes and pricing page (plain module; read by the server page). */
export const QUOTES_TABS = [
  { key: "pipeline", label: "Leads and quotes" },
  { key: "rate-card", label: "Rate card" },
  { key: "price-book", label: "Price book" },
  { key: "holiday-rates", label: "Holiday rates" },
  { key: "pricing-variables", label: "Pricing variables" },
  { key: "client-rates", label: "Client rates" },
] as const;

export type QuotesTab = (typeof QUOTES_TABS)[number]["key"];

/** Older tab names used by the previous pipeline page keep their meaning. */
const ALIASES: Record<string, QuotesTab> = { leads: "pipeline", quotes: "pipeline", pricing: "rate-card", pricebook: "price-book" };

export function parseQuotesTab(value: string | undefined | null): QuotesTab {
  if (!value) return "pipeline";
  if (ALIASES[value]) return ALIASES[value];
  return QUOTES_TABS.some((tab) => tab.key === value) ? (value as QuotesTab) : "pipeline";
}
