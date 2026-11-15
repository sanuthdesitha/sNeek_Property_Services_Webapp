/**
 * Existing properties missing a field the property form now requires
 * (owner default 2026-11-17, board "Property form"): the Properties list
 * offers a "Missing required details" filter. Nothing is blocked; the field
 * is asked the next time someone edits that property.
 *
 * Uses the same rules as a new property (collectMissingRequired), on the
 * values the property has stored. The access code is checked for presence
 * only (its encrypted column or the legacy JSON); its value is never read out.
 *
 * PURE.
 */
import { collectMissingRequired, type MissingField, type PropertyFormConfig } from "./config";

export type StoredPropertyFacts = {
  clientId: string | null;
  name: string;
  address: string;
  suburb: string;
  state: string | null;
  postcode: string | null;
  linenBufferSets: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  defaultCheckinTime: string | null;
  defaultCheckoutTime: string | null;
  hasBalcony: boolean | null;
  inventoryEnabled: boolean | null;
  laundryEnabled: boolean | null;
  cleaningDurationMinutes: number | null;
  assignedCleaningHours: number | null;
  cleanerServiceRate: number | null;
  sofaBedCount: number | null;
  laundryBagLabel: string | null;
  laundryBagColor: string | null;
  setupGuide: unknown;
  notes: string | null;
  accessInfo: unknown;
  /** Whether the encrypted access code column holds anything. */
  hasAccessCode: boolean;
  customFields: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The flat value map the form config evaluates, keyed like the create form. */
export function storedSystemValues(property: StoredPropertyFacts): Record<string, unknown> {
  const access = record(property.accessInfo);
  const legacyCode = typeof access.codes === "string" && access.codes.trim() ? access.codes : "";
  return {
    clientId: property.clientId,
    name: property.name,
    address: property.address,
    suburb: property.suburb,
    state: property.state,
    postcode: property.postcode,
    linenBufferSets: property.linenBufferSets,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    defaultCleanDurationHours: access.defaultCleanDurationHours,
    maxGuestCount: access.maxGuestCount,
    defaultCheckinTime: property.defaultCheckinTime,
    defaultCheckoutTime: property.defaultCheckoutTime,
    hasBalcony: property.hasBalcony,
    inventoryEnabled: property.inventoryEnabled,
    laundryEnabled: property.laundryEnabled,
    lockbox: access.lockbox,
    codes: property.hasAccessCode ? "set" : legacyCode,
    parking: access.parking,
    other: access.other,
    instructions: access.instructions,
    laundryTeam: Array.isArray(access.laundryTeamUserIds) ? access.laundryTeamUserIds : [],
    cleaningDurationMinutes: property.cleaningDurationMinutes,
    assignedCleaningHours: property.assignedCleaningHours,
    cleanerServiceRate: property.cleanerServiceRate,
    sofaBedCount: property.sofaBedCount,
    laundryBagLabel: property.laundryBagLabel,
    laundryBagColor: property.laundryBagColor,
    setupGuide: property.setupGuide,
    notes: property.notes,
  };
}

/** Required fields (system and custom) this stored property leaves blank. */
export function missingRequiredForProperty(config: PropertyFormConfig, property: StoredPropertyFacts): MissingField[] {
  return collectMissingRequired(config, storedSystemValues(property), record(property.customFields));
}
