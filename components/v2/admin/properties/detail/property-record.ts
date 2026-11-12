/**
 * The property as GET /api/admin/properties/:id returns it (the fields the
 * property page reads), and the PATCH body pieces each section sends. A
 * section sends only the keys it owns; the API merges accessInfo over the
 * stored row, so a partial save never drops the rest.
 */
import type { SetupGuideEntry } from "../property-setup-guide-editor";

export type SyncRunRecord = {
  id: string;
  status: string;
  createdAt: string | null;
  completedAt?: string | null;
  revertedAt: string | null;
  error?: string | null;
  summary?: { reservationsCreated?: number; jobsCreated?: number; jobsUpdated?: number; reservationsUpdated?: number } | null;
};

export type StockRecord = {
  itemId: string;
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  item?: { name?: string; category?: string; unit?: string } | null;
};

export type PropertyRecord = {
  id: string;
  name: string;
  address: string;
  suburb: string;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  imageUrl: string | null;
  notes: string | null;
  isActive: boolean;
  accessInfo: Record<string, unknown> | null;
  accessCode: string | null;
  accessGuide: unknown[] | null;
  linenBufferSets: number;
  inventoryEnabled: boolean;
  laundryEnabled: boolean;
  keyLostMode: boolean;
  defaultCheckinTime: string | null;
  defaultCheckoutTime: string | null;
  hasBalcony: boolean;
  bedrooms: number;
  bathrooms: number;
  sofaBedCount: number;
  showCleanerContactToClient: boolean;
  cleaningDurationMinutes: number | null;
  assignedCleaningHours: number | null;
  cleanerServiceRate: number | null;
  laundryBagLabel: string | null;
  laundryBagColor: string | null;
  setupGuide: SetupGuideEntry[] | null;
  floorCount: number | null;
  laundryDetail: unknown;
  recurringSchedule: unknown;
  client: { id: string; name: string } | null;
  integration: {
    icalUrl: string | null;
    isEnabled: boolean;
    syncStatus: string | null;
    syncError: string | null;
    lastSyncAt: string | null;
    syncRuns?: SyncRunRecord[];
  } | null;
  propertyStock: StockRecord[];
  _count?: { jobs?: number; reservations?: number };
};

export type PropertyPatch = Record<string, unknown>;

export function accessText(property: PropertyRecord, key: string): string {
  const value = property.accessInfo?.[key];
  return typeof value === "string" ? value : "";
}

export function laundryTeamIds(property: PropertyRecord): string[] {
  const value = property.accessInfo?.laundryTeamUserIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** Optional number field from a text input: blank is null (cleared), never 0. */
export function optionalNumber(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

/**
 * A save that touches accessInfo makes the server drop a legacy plaintext
 * door code from the JSON. When that is the only copy (nothing in the
 * encrypted column yet), send it along so it moves to the encrypted column.
 */
export function legacyCodeCarry(property: PropertyRecord): { accessCode?: string } {
  const legacy = accessText(property, "codes").trim();
  return !property.accessCode && legacy ? { accessCode: legacy } : {};
}
