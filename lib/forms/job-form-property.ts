/** Cleaner-visible operational context. Kept explicit to exclude customer,
 * financial and internal fields from template conditions and API payloads. */
const jobFormPropertyColumns = {
  name: true, address: true, suburb: true, state: true, postcode: true,
  latitude: true, longitude: true, placeId: true, linenBufferSets: true,
  accessInfo: true, hasBalcony: true, bedrooms: true, bathrooms: true,
  inventoryEnabled: true, laundryEnabled: true, cleaningDurationMinutes: true,
  laundryBagLabel: true, laundryBagColor: true, sofaBedCount: true, setupGuide: true,
  floorCount: true, defaultCheckinTime: true, defaultCheckoutTime: true,
} as const;

/**
 * Facts derived from a stored column rather than read from one. The raw
 * column (`features`, the amenity JSON) is selected so the fact can be worked
 * out, but only the derived boolean ever reaches a form, a rule or a payload.
 */
type FeatureFact = {
  /** The key a form rule reads, e.g. "hasLivePlants". */
  key: string;
  /** The Property.features flag it is true for, e.g. "livePlants". */
  feature: string;
};

const FEATURE_FACTS: readonly FeatureFact[] = [
  { key: "hasLivePlants", feature: "livePlants" },
];

function isFeatureFactKey(key: string): boolean {
  return FEATURE_FACTS.some((fact) => fact.key === key);
}

/**
 * True only when `features[feature] === true`. A property loaded without its
 * features gives undefined (unknown), never false; a property that was
 * already projected (the cleaner payload) carries the fact itself.
 */
function readFeatureFact(property: Record<string, unknown>, fact: FeatureFact): boolean | undefined {
  if (Object.hasOwn(property, "features")) {
    const features = property.features;
    if (!features || typeof features !== "object" || Array.isArray(features)) return false;
    return (features as Record<string, unknown>)[fact.feature] === true;
  }
  const carried = property[fact.key];
  return typeof carried === "boolean" ? carried : undefined;
}

/** Prisma select for the cleaner-visible property: the columns plus the inputs of derived facts. */
export const jobFormPropertySelect = { ...jobFormPropertyColumns, features: true } as const;

/** Keys a form's property rule may read: the visible columns and the derived facts. */
export function isJobFormPropertyKey(key: unknown): key is string {
  return typeof key === "string" && (Object.hasOwn(jobFormPropertyColumns, key) || isFeatureFactKey(key));
}

/** The derived facts of one property (`hasLivePlants`), omitted when the input is not known. */
export function deriveJobFormPropertyFacts(property: Record<string, unknown> | null | undefined): Record<string, boolean> {
  const facts: Record<string, boolean> = {};
  if (!property || typeof property !== "object") return facts;
  for (const fact of FEATURE_FACTS) {
    const value = readFeatureFact(property, fact);
    if (value !== undefined) facts[fact.key] = value;
  }
  return facts;
}

/**
 * The property as a cleaner's form payload carries it: the raw amenity JSON
 * replaced by its derived facts. Other keys are left as they are.
 */
export function withJobFormPropertyFacts<T extends Record<string, unknown>>(property: T): Omit<T, "features"> & Record<string, unknown> {
  const facts = deriveJobFormPropertyFacts(property);
  const { features: _features, ...rest } = property;
  return { ...rest, ...facts };
}

export class UnsupportedFormPropertyConditionError extends Error {
  constructor() { super("The form uses an unsupported property condition. Contact the office to update the form."); }
}

/** Literal-key projection shared by the renderer, validation and fingerprint.
 * An unsupported condition fails closed; it must never hide required evidence. */
export function jobFormProperty(schema: unknown, property: Record<string, unknown>): Record<string, unknown> {
  function visit(node: any) {
    if (!node || typeof node !== "object") return;
    if (node.conditional && Object.hasOwn(node.conditional, "propertyField")) {
      const key = node.conditional.propertyField;
      if (!isJobFormPropertyKey(key)) {
        throw new UnsupportedFormPropertyConditionError();
      }
    }
    for (const key of ["sections", "fields", "children"]) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  }
  visit(schema);
  const columns = Object.keys(jobFormPropertyColumns)
    .filter(key => Object.hasOwn(property, key) && property[key] !== undefined)
    .map(key => [key, property[key]] as const);
  return { ...Object.fromEntries(columns), ...deriveJobFormPropertyFacts(property) };
}
