import type { Property } from "@prisma/client";

/**
 * Property feature/amenity catalog — the flags that drive per-property
 * checklist composition (Property.features JSON). The onboarding survey's
 * appliance rows map onto these, and admins can edit them on the property.
 */
export interface FeatureDef {
  key: string;
  label: string;
  /** Grouping shown in editors. */
  group: "KITCHEN" | "LAUNDRY" | "OUTDOOR" | "GENERAL";
  /** OnboardingAppliance.applianceType values that set this feature. */
  applianceTypes?: string[];
  /** Lowercase keywords used to auto-tag existing checklist items during seed. */
  keywords?: string[];
}

export const FEATURE_DEFS: FeatureDef[] = [
  { key: "dishwasher", label: "Dishwasher", group: "KITCHEN", applianceTypes: ["DISHWASHER"], keywords: ["dishwasher"] },
  { key: "oven", label: "Oven / grill", group: "KITCHEN", applianceTypes: ["OVEN"], keywords: ["oven", "grill"] },
  { key: "microwave", label: "Microwave", group: "KITCHEN", applianceTypes: ["MICROWAVE"], keywords: ["microwave"] },
  { key: "fridge", label: "Fridge / freezer", group: "KITCHEN", applianceTypes: ["FRIDGE"], keywords: ["fridge", "freezer", "refrigerator"] },
  { key: "rangehood", label: "Rangehood", group: "KITCHEN", applianceTypes: ["RANGEHOOD"], keywords: ["rangehood", "range hood"] },
  { key: "coffeeMachine", label: "Coffee machine", group: "KITCHEN", keywords: ["coffee machine", "espresso"] },
  { key: "washer", label: "Washing machine", group: "LAUNDRY", applianceTypes: ["WASHER"], keywords: ["washing machine", "washer"] },
  { key: "dryer", label: "Dryer", group: "LAUNDRY", applianceTypes: ["DRYER"], keywords: ["dryer", "tumble"] },
  { key: "bbq", label: "BBQ", group: "OUTDOOR", keywords: ["bbq", "barbecue", "barbeque"] },
  { key: "pool", label: "Pool", group: "OUTDOOR", keywords: ["pool"] },
  { key: "spa", label: "Spa / hot tub", group: "OUTDOOR", keywords: ["spa", "hot tub", "jacuzzi"] },
  { key: "garage", label: "Garage", group: "OUTDOOR", keywords: ["garage"] },
  // NB: no "lawn" keyword — it would wrongly feature-gate the LAWN_MOWING
  // service's "Mow lawn" task (that service is chosen by job type, not feature).
  { key: "garden", label: "Garden / lawn", group: "OUTDOOR", keywords: ["garden"] },
  { key: "fireplace", label: "Fireplace", group: "GENERAL", keywords: ["fireplace"] },
  { key: "petFriendly", label: "Pet-friendly (pet hair)", group: "GENERAL", keywords: ["pet hair", "pet-friendly"] },
  { key: "airConditioner", label: "Air conditioner", group: "GENERAL", keywords: ["air con", "aircon", "air-con", "a/c filter"] },
];

export const FEATURE_KEYS = FEATURE_DEFS.map((f) => f.key);

export type PropertyFeatures = Record<string, boolean>;

export function sanitizeFeatures(input: unknown): PropertyFeatures {
  const out: PropertyFeatures = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (FEATURE_KEYS.includes(key)) out[key] = value === true;
    }
  }
  return out;
}

/** Map onboarding appliance rows → feature flags. */
export function featuresFromAppliances(
  appliances: Array<{ applianceType: string; requiresClean?: boolean | null }>
): PropertyFeatures {
  const out: PropertyFeatures = {};
  for (const appliance of appliances) {
    const def = FEATURE_DEFS.find((f) => f.applianceTypes?.includes(appliance.applianceType));
    if (def) out[def.key] = true;
  }
  return out;
}

/**
 * Auto-apply rule attached to a checklist module or item:
 *   { feature: "dishwasher" }                          → features.dishwasher === true
 *   { propertyField: "hasBalcony", equals: true }      → property column equals
 *   { propertyField: "sofaBedCount", operator: "gt",
 *     value: 0 }                                       → numeric comparison
 *   null / undefined                                   → always applies
 *
 * `operator` defaults to "equals" (the historical behaviour); "gt"/"lt" enable
 * numeric comparisons (e.g. gate a sofa-bed task on sofaBedCount > 0). The
 * comparison operand is read from either `value` (operator form) or the legacy
 * `equals` key.
 */
export type AppliesWhenOperator = "equals" | "gt" | "lt";

export interface AppliesWhenRule {
  feature?: string;
  propertyField?: string;
  operator?: AppliesWhenOperator;
  equals?: unknown;
}

export type PropertyForRules = Pick<
  Property,
  "hasBalcony" | "bedrooms" | "bathrooms" | "laundryEnabled" | "inventoryEnabled"
> & { features?: unknown; sofaBedCount?: number | null };

export function parseAppliesWhen(raw: unknown): AppliesWhenRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rule = raw as Record<string, unknown>;
  if (typeof rule.feature === "string" && rule.feature.trim()) {
    return { feature: rule.feature.trim() };
  }
  if (typeof rule.propertyField === "string" && rule.propertyField.trim()) {
    const operator: AppliesWhenOperator =
      rule.operator === "gt" || rule.operator === "lt" ? rule.operator : "equals";
    // Comparison operand: prefer the operator-form `value`, fall back to the
    // legacy `equals` shape, defaulting to `true` for boolean-style gates.
    const operand = "equals" in rule ? rule.equals : "value" in rule ? rule.value : true;
    return { propertyField: rule.propertyField.trim(), operator, equals: operand };
  }
  return null;
}

/** Evaluate a module/item auto-apply rule against a property. */
export function ruleApplies(raw: unknown, property: PropertyForRules): boolean {
  const rule = parseAppliesWhen(raw);
  if (!rule) return true; // no rule = always applies
  if (rule.feature) {
    const features = sanitizeFeatures(property.features);
    return features[rule.feature] === true;
  }
  if (rule.propertyField) {
    const actual = (property as unknown as Record<string, unknown>)[rule.propertyField];
    const expected = rule.equals ?? true;
    const operator = rule.operator ?? "equals";
    if (operator === "gt") return Number(actual) > Number(expected);
    if (operator === "lt") return Number(actual) < Number(expected);
    if (typeof actual === "boolean") return actual === (expected === true || expected === "true");
    if (typeof actual === "number") return actual === Number(expected);
    return String(actual ?? "") === String(expected ?? "");
  }
  return true;
}
