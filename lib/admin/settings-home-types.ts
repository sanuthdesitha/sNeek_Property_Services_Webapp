/**
 * Settings home shapes and the search entries for settings that live on other
 * pages (plain module, shared by the server page and the client home).
 */

export type SettingsDestinationState = { tone: "bad" | "warn"; text: string; detail: string };

export type SettingsRecentChange = { id: string; at: string; action: string; by: string };

/** Settings kept on other pages, found by the Settings search (not catalog entries). */
export type ElsewhereSetting = { key: string; label: string; description: string; place: string; href: string; mark?: string };

export const SETTINGS_ELSEWHERE: readonly ElsewhereSetting[] = [
  { key: "rate-card", label: "Rate card", description: "Rack rate, cleaner cost, margin floor and service rates used by every quote.", place: "Quotes and pricing", href: "/v2/admin/quotes?tab=rate-card", mark: "PIN" },
  { key: "price-book", label: "Price book", description: "Extras and add-ons priced in quotes.", place: "Quotes and pricing", href: "/v2/admin/quotes?tab=price-book" },
  { key: "client-rates", label: "Client rates", description: "Per-property client prices by job type.", place: "Quotes and pricing", href: "/v2/admin/quotes?tab=client-rates" },
];

/** Case-insensitive match on every word of the query against name and description. */
export function matchesSettingsQuery(query: string, ...fields: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}
