/**
 * Onboarding workspace data (2026-11-16, board "Property onboarding steps").
 *
 * The survey row keeps every field it had; the structured sections it had no
 * columns for live in `PropertyOnboardingSurvey.workspace` with this shape.
 * Plain module (no "use client", no server imports): the workspace screen,
 * the public client page, the routes and the tests all read it.
 */

export const ONBOARDING_WORKSPACE_VERSION = 1;

/** Who supplied an answer. Mirrors `OnboardingSourceType` (CLIENT_SUBMITTED = the client's link). */
export type OnboardingAnswerSource = "ADMIN_CREATED" | "CLIENT_SUBMITTED";

export type OnboardingRoomKind = "BEDROOM" | "BATHROOM" | "LIVING" | "KITCHEN" | "OTHER";

export type OnboardingRoom = {
  id: string;
  name: string;
  kind: OnboardingRoomKind;
  beds: string;
  notes: string;
};

export type OnboardingRooms = {
  list: OnboardingRoom[];
  /** Free text kept from the old "bed configuration" field; never discarded. */
  note: string | null;
  sofaBeds: number | null;
};

export type OnboardingAccessKind = "LOCKBOX" | "KEYS" | "ENTRY" | "ALARM" | "PARKING" | "WIFI" | "OTHER";

export type OnboardingPhoto = { url: string; key: string; source: OnboardingAnswerSource };

/** As stored: the code is ciphertext from `encryptSecret`, never plain text. */
export type StoredAccessEntry = {
  id: string;
  kind: OnboardingAccessKind;
  where: string;
  codeCipher: string | null;
  photos: OnboardingPhoto[];
  source: OnboardingAnswerSource;
  /** A code the client typed waits for the office: null until reviewed. */
  codeReviewedAt: string | null;
  codeReviewedById: string | null;
};

/** As sent to the office screen: whether a code exists, never the code. */
export type AccessEntryView = Omit<StoredAccessEntry, "codeCipher"> & {
  hasCode: boolean;
  codeNeedsReview: boolean;
};

export type StockStartingList = "ONE_BED" | "TWO_BED" | "THREE_PLUS";

export type OnboardingStockRow = {
  sku: string;
  name: string;
  unit: string;
  parLevel: number | null;
  reorderAt: number | null;
};

export type OnboardingStock = {
  startFrom: StockStartingList | null;
  rows: OnboardingStockRow[];
};

export type OnboardingRoomPhoto = {
  id: string;
  room: string;
  caption: string;
  photo: OnboardingPhoto | null;
  /** Asked of the client and not yet supplied. */
  askedOfClient: boolean;
};

export type OnboardingBillingUnit = "PER_JOB" | "PER_HOUR";
export type OnboardingCleanerPayMode = "PER_CLEAN" | "HOURLY";

export type OnboardingRate = {
  jobType: string;
  /** Ex GST. Null means no rate yet; never read as zero. */
  clientRate: number | null;
  billingUnit: OnboardingBillingUnit;
  cleanerPayMode: OnboardingCleanerPayMode;
  cleanerPay: number | null;
};

/** Pets, bins and parking keep their existing survey fields (scenarios); these two are new. */
export type OnboardingHouseRules = {
  hazards: string;
  buildingRules: string;
};

export type OnboardingJobTimeSource = "PROPERTY" | "ICAL";

export type OnboardingLaundryExtras = {
  bagLabel: string;
  bagColor: string;
};

export type OnboardingWorkspaceData = {
  version: number;
  rooms: OnboardingRooms;
  access: StoredAccessEntry[];
  stock: OnboardingStock;
  roomPhotos: OnboardingRoomPhoto[];
  rates: OnboardingRate[];
  houseRules: OnboardingHouseRules;
  laundry: OnboardingLaundryExtras;
  /** Metres; null means the property's default radius. */
  clockInRadiusM: number | null;
  jobTimeSource: OnboardingJobTimeSource;
  /** Recommended sections the office chose to skip (counted as resolved). */
  skipped: string[];
};

export const EMPTY_HOUSE_RULES: OnboardingHouseRules = { hazards: "", buildingRules: "" };

export function emptyWorkspace(): OnboardingWorkspaceData {
  return {
    version: ONBOARDING_WORKSPACE_VERSION,
    rooms: { list: [], note: null, sofaBeds: null },
    access: [],
    stock: { startFrom: null, rows: [] },
    roomPhotos: [],
    rates: [],
    houseRules: { ...EMPTY_HOUSE_RULES },
    laundry: { bagLabel: "", bagColor: "" },
    clockInRadiusM: null,
    jobTimeSource: "PROPERTY",
    skipped: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asSource(value: unknown): OnboardingAnswerSource {
  return value === "CLIENT_SUBMITTED" ? "CLIENT_SUBMITTED" : "ADMIN_CREATED";
}

const ROOM_KINDS: readonly OnboardingRoomKind[] = ["BEDROOM", "BATHROOM", "LIVING", "KITCHEN", "OTHER"];
export const ACCESS_KINDS: readonly OnboardingAccessKind[] = ["LOCKBOX", "KEYS", "ENTRY", "ALARM", "PARKING", "WIFI", "OTHER"];
const STARTING_LISTS: readonly StockStartingList[] = ["ONE_BED", "TWO_BED", "THREE_PLUS"];

function readPhoto(value: unknown): OnboardingPhoto | null {
  const record = asRecord(value);
  const url = asText(record.url);
  const key = asText(record.key);
  return url && key ? { url, key, source: asSource(record.source) } : null;
}

function readRoom(value: unknown, index: number): OnboardingRoom {
  const record = asRecord(value);
  const kind = ROOM_KINDS.includes(record.kind as OnboardingRoomKind) ? (record.kind as OnboardingRoomKind) : "OTHER";
  return { id: asText(record.id) || `room-${index + 1}`, name: asText(record.name), kind, beds: asText(record.beds), notes: asText(record.notes) };
}

function readAccess(value: unknown, index: number): StoredAccessEntry {
  const record = asRecord(value);
  const kind = ACCESS_KINDS.includes(record.kind as OnboardingAccessKind) ? (record.kind as OnboardingAccessKind) : "OTHER";
  return {
    id: asText(record.id) || `access-${index + 1}`,
    kind,
    where: asText(record.where),
    codeCipher: typeof record.codeCipher === "string" && record.codeCipher ? record.codeCipher : null,
    photos: Array.isArray(record.photos) ? record.photos.map(readPhoto).filter((photo): photo is OnboardingPhoto => photo !== null) : [],
    source: asSource(record.source),
    codeReviewedAt: typeof record.codeReviewedAt === "string" ? record.codeReviewedAt : null,
    codeReviewedById: typeof record.codeReviewedById === "string" ? record.codeReviewedById : null,
  };
}

function readStockRow(value: unknown): OnboardingStockRow | null {
  const record = asRecord(value);
  const sku = asText(record.sku);
  if (!sku) return null;
  return { sku, name: asText(record.name), unit: asText(record.unit), parLevel: asNullableNumber(record.parLevel), reorderAt: asNullableNumber(record.reorderAt) };
}

function readRoomPhoto(value: unknown, index: number): OnboardingRoomPhoto {
  const record = asRecord(value);
  return {
    id: asText(record.id) || `photo-${index + 1}`,
    room: asText(record.room),
    caption: asText(record.caption),
    photo: readPhoto(record.photo),
    askedOfClient: record.askedOfClient === true,
  };
}

function readRate(value: unknown): OnboardingRate | null {
  const record = asRecord(value);
  const jobType = asText(record.jobType);
  if (!jobType) return null;
  return {
    jobType,
    clientRate: asNullableNumber(record.clientRate),
    billingUnit: record.billingUnit === "PER_HOUR" ? "PER_HOUR" : "PER_JOB",
    cleanerPayMode: record.cleanerPayMode === "HOURLY" ? "HOURLY" : "PER_CLEAN",
    cleanerPay: asNullableNumber(record.cleanerPay),
  };
}

/**
 * Read a stored workspace (or nothing) into the full shape. Unknown keys are
 * dropped, missing numbers stay null (never zero), and the old free-text bed
 * configuration is carried into the room list's note when the room list has
 * no note of its own, so the text an earlier wizard saved is never lost.
 */
export function readWorkspace(raw: unknown, legacyBedConfig?: string | null): OnboardingWorkspaceData {
  const record = asRecord(raw);
  const base = emptyWorkspace();
  const rooms = asRecord(record.rooms);
  const stock = asRecord(record.stock);
  const houseRules = asRecord(record.houseRules);
  const laundry = asRecord(record.laundry);
  const storedNote = typeof rooms.note === "string" && rooms.note.trim() ? rooms.note : null;
  const legacyNote = typeof legacyBedConfig === "string" && legacyBedConfig.trim() ? legacyBedConfig.trim() : null;
  const radius = asNullableNumber(record.clockInRadiusM);
  return {
    version: ONBOARDING_WORKSPACE_VERSION,
    rooms: {
      list: Array.isArray(rooms.list) ? rooms.list.map(readRoom) : base.rooms.list,
      note: storedNote ?? legacyNote,
      sofaBeds: asNullableNumber(rooms.sofaBeds),
    },
    access: Array.isArray(record.access) ? record.access.map(readAccess) : [],
    stock: {
      startFrom: STARTING_LISTS.includes(stock.startFrom as StockStartingList) ? (stock.startFrom as StockStartingList) : null,
      rows: Array.isArray(stock.rows) ? stock.rows.map(readStockRow).filter((row): row is OnboardingStockRow => row !== null) : [],
    },
    roomPhotos: Array.isArray(record.roomPhotos) ? record.roomPhotos.map(readRoomPhoto) : [],
    rates: Array.isArray(record.rates) ? record.rates.map(readRate).filter((rate): rate is OnboardingRate => rate !== null) : [],
    houseRules: { hazards: asText(houseRules.hazards), buildingRules: asText(houseRules.buildingRules) },
    laundry: { bagLabel: asText(laundry.bagLabel), bagColor: asText(laundry.bagColor) },
    clockInRadiusM: radius !== null && radius > 0 ? Math.round(radius) : null,
    jobTimeSource: record.jobTimeSource === "ICAL" ? "ICAL" : "PROPERTY",
    skipped: Array.isArray(record.skipped) ? record.skipped.filter((key): key is string => typeof key === "string") : [],
  };
}

/** The office view of an access entry: whether a code exists, never its value. */
export function accessEntryView(entry: StoredAccessEntry): AccessEntryView {
  const { codeCipher, ...rest } = entry;
  return {
    ...rest,
    hasCode: Boolean(codeCipher),
    codeNeedsReview: Boolean(codeCipher) && entry.source === "CLIENT_SUBMITTED" && !entry.codeReviewedAt,
  };
}
