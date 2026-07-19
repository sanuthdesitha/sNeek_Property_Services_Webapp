// Canonical registry of the editable SYSTEM fields on the property intake form.
// This is the single source of truth shared by the admin editor (what can be
// toggled) and the create form (how each field renders / persists). It does NOT
// duplicate the form's markup — it only describes each field's identity, which
// group it belongs to, and its default/locked required behaviour.

export type PropertyFieldGroup = "details" | "access" | "quality" | "notes";

export interface PropertyFieldDef {
  /** Stable id — matches the create form's state key so wiring is 1:1. */
  id: string;
  label: string;
  group: PropertyFieldGroup;
  /**
   * Core identity fields (client/name/address/suburb) that drive maps, billing
   * and identity. Locked = always required, cannot be hidden. Surfaced in the
   * editor as a lock so an admin can never break the form.
   */
  locked?: boolean;
  /**
   * Whether "required" is meaningful for this field. Booleans/toggles and
   * repeating sub-editors (inventory, laundry team, setup guide) can be hidden
   * or made conditional but never "required".
   */
  supportsRequired?: boolean;
  /** Required by default when the admin hasn't overridden it. */
  defaultRequired?: boolean;
}

export const PROPERTY_FIELD_GROUPS: { id: PropertyFieldGroup; label: string }[] = [
  { id: "details", label: "Property details" },
  { id: "access", label: "Access & instructions" },
  { id: "quality", label: "Quality & accountability" },
  { id: "notes", label: "Notes" },
];

export const PROPERTY_SYSTEM_FIELDS: PropertyFieldDef[] = [
  // ── Property details ───────────────────────────────────────────────────────
  { id: "clientId", label: "Client", group: "details", locked: true, supportsRequired: true, defaultRequired: true },
  { id: "name", label: "Property name", group: "details", locked: true, supportsRequired: true, defaultRequired: true },
  { id: "address", label: "Address", group: "details", locked: true, supportsRequired: true, defaultRequired: true },
  { id: "suburb", label: "Suburb", group: "details", locked: true, supportsRequired: true, defaultRequired: true },
  { id: "state", label: "State", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "postcode", label: "Postcode", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "linenBufferSets", label: "Linen buffer sets", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "bedrooms", label: "Bedrooms", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "bathrooms", label: "Bathrooms", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "defaultCleanDurationHours", label: "Clean duration (hrs)", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "maxGuestCount", label: "Max guests", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "defaultCheckinTime", label: "Default check-in time", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "defaultCheckoutTime", label: "Default checkout time", group: "details", supportsRequired: true, defaultRequired: false },
  { id: "hasBalcony", label: "Has balcony", group: "details", supportsRequired: false },
  { id: "inventoryEnabled", label: "Inventory enabled", group: "details", supportsRequired: false },
  { id: "laundryEnabled", label: "Laundry service enabled", group: "details", supportsRequired: false },
  // ── Access & instructions ──────────────────────────────────────────────────
  { id: "lockbox", label: "Lockbox", group: "access", supportsRequired: true, defaultRequired: false },
  { id: "codes", label: "Access codes", group: "access", supportsRequired: true, defaultRequired: false },
  { id: "parking", label: "Parking", group: "access", supportsRequired: true, defaultRequired: false },
  { id: "other", label: "Other access", group: "access", supportsRequired: true, defaultRequired: false },
  { id: "instructions", label: "Access instructions", group: "access", supportsRequired: true, defaultRequired: false },
  { id: "laundryTeam", label: "Laundry team", group: "access", supportsRequired: false },
  // ── Quality & accountability ───────────────────────────────────────────────
  { id: "assignedCleaningHours", label: "Assigned cleaning hours", group: "quality", supportsRequired: true, defaultRequired: false },
  { id: "cleaningDurationMinutes", label: "Clean duration (min)", group: "quality", supportsRequired: true, defaultRequired: false },
  { id: "cleanerServiceRate", label: "Cleaner service rate ($)", group: "quality", supportsRequired: true, defaultRequired: false },
  { id: "sofaBedCount", label: "Sofa beds", group: "quality", supportsRequired: true, defaultRequired: false },
  { id: "laundryBagLabel", label: "Laundry bag label", group: "quality", supportsRequired: true, defaultRequired: false },
  { id: "laundryBagColor", label: "Laundry bag colour", group: "quality", supportsRequired: false },
  { id: "setupGuide", label: "Setup guide", group: "quality", supportsRequired: false },
  // ── Notes ──────────────────────────────────────────────────────────────────
  { id: "notes", label: "Notes", group: "notes", supportsRequired: true, defaultRequired: false },
];

export const PROPERTY_SYSTEM_FIELD_MAP: Record<string, PropertyFieldDef> = Object.fromEntries(
  PROPERTY_SYSTEM_FIELDS.map((f) => [f.id, f]),
);

/** True when the field id is a real, editable system field. */
export function isKnownSystemField(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROPERTY_SYSTEM_FIELD_MAP, id);
}
