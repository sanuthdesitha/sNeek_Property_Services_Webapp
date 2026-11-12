/** Lost and found list vocabulary (tabs, sorts, value filter). Pure; safe for client bundles. */
import { LOST_FOUND_STAGES } from "./status";

export const LOST_FOUND_SORTS = ["found", "item", "property", "guest", "stored", "status"] as const;
export type LostFoundSort = (typeof LOST_FOUND_SORTS)[number];

export const LOST_FOUND_TABS = [...LOST_FOUND_STAGES, "all"] as const;
export type LostFoundTab = (typeof LOST_FOUND_TABS)[number];

export const VALUE_FILTERS = ["any", "recorded", "none", "under100", "100plus"] as const;
export type ValueFilter = (typeof VALUE_FILTERS)[number];

export const VALUE_FILTER_LABEL: Record<ValueFilter, string> = {
  any: "Any",
  recorded: "Value recorded",
  none: "No value recorded",
  under100: "Under $100",
  "100plus": "$100 or more",
};
