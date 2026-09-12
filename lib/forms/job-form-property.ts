/** Cleaner-visible operational context. Kept explicit to exclude customer,
 * financial and internal fields from template conditions and API payloads. */
export const jobFormPropertySelect = {
  name: true, address: true, suburb: true, state: true, postcode: true,
  latitude: true, longitude: true, placeId: true, linenBufferSets: true,
  accessInfo: true, hasBalcony: true, bedrooms: true, bathrooms: true,
  inventoryEnabled: true, laundryEnabled: true, cleaningDurationMinutes: true,
  laundryBagLabel: true, laundryBagColor: true, sofaBedCount: true, setupGuide: true,
  floorCount: true, defaultCheckinTime: true, defaultCheckoutTime: true,
} as const;

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
      if (typeof key !== "string" || !Object.hasOwn(jobFormPropertySelect, key)) {
        throw new UnsupportedFormPropertyConditionError();
      }
    }
    for (const key of ["sections", "fields", "children"]) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  }
  visit(schema);
  return Object.fromEntries(Object.keys(jobFormPropertySelect)
    .filter(key => Object.hasOwn(property, key) && property[key] !== undefined)
    .map(key => [key, property[key]]));
}
