/**
 * Property facts a show/hide rule can read ("Shown if the property has a
 * balcony"). Every key here is in the cleaner-visible projection
 * (lib/forms/job-form-property.ts → jobFormPropertySelect), so the phone and
 * the submit route evaluate the rule from the same data. Equality only, as
 * lib/forms/visibility.ts compares them.
 *
 * Client-safe: no database.
 */
import type { PropertyFieldCondition } from "./types";

export type PropertyConditionKind = "boolean" | "number";

export type PropertyConditionKey = {
  key: string;
  label: string;
  kind: PropertyConditionKind;
  /** Wording for a badge: `Property ${phrase(value)}`. */
  phrase: (value: unknown) => string;
};

const yesNo = (yes: string, no: string) => (value: unknown) => (value === true || value === "true" ? yes : no);
const count = (noun: string) => (value: unknown) => `has ${String(value ?? "?")} ${noun}`;

export const PROPERTY_CONDITION_KEYS: readonly PropertyConditionKey[] = [
  { key: "hasBalcony", label: "Has a balcony", kind: "boolean", phrase: yesNo("has a balcony", "has no balcony") },
  { key: "inventoryEnabled", label: "Tracks stock", kind: "boolean", phrase: yesNo("tracks stock", "does not track stock") },
  { key: "laundryEnabled", label: "Has laundry service", kind: "boolean", phrase: yesNo("has laundry service", "has no laundry service") },
  { key: "bedrooms", label: "Number of bedrooms", kind: "number", phrase: count("bedrooms") },
  { key: "bathrooms", label: "Number of bathrooms", kind: "number", phrase: count("bathrooms") },
  { key: "sofaBedCount", label: "Number of sofa beds", kind: "number", phrase: count("sofa beds") },
  { key: "floorCount", label: "Number of floors", kind: "number", phrase: count("floors") },
  { key: "linenBufferSets", label: "Spare linen sets", kind: "number", phrase: count("spare linen sets") },
];

export function propertyConditionKey(key: string): PropertyConditionKey | undefined {
  return PROPERTY_CONDITION_KEYS.find((entry) => entry.key === key);
}

/** The operand a stored property rule compares against (`value`, else legacy `equals`). */
export function propertyConditionValue(condition: PropertyFieldCondition): unknown {
  return "value" in condition ? condition.value : condition.equals;
}

/** Short badge text, e.g. "If property has a balcony". */
export function describePropertyCondition(condition: PropertyFieldCondition): string {
  const meta = propertyConditionKey(condition.propertyField);
  const value = propertyConditionValue(condition);
  if (!meta) return `If property ${condition.propertyField} is ${String(value)}`;
  return `If property ${meta.phrase(value)}`;
}
