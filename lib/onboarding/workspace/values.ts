/**
 * Section values: what each workspace step shows and saves, built from the
 * survey's existing columns, its `formMeta` envelope and the new `workspace`
 * JSON, and written back to the same places. Every field the 13-step wizard
 * had keeps its storage, so the existing approval code reads it unchanged.
 *
 * Pure module (no "use client", no server imports): encryption is passed in.
 * The service, the public client route and the tests use it; the screens use
 * its types.
 */
import type { OnboardingFormMeta } from "@/lib/onboarding/form-meta";
import {
  accessEntryView,
  type AccessEntryView,
  type OnboardingAccessKind,
  type OnboardingAnswerSource,
  type OnboardingHouseRules,
  type OnboardingJobTimeSource,
  type OnboardingPhoto,
  type OnboardingRate,
  type OnboardingRoom,
  type OnboardingRoomPhoto,
  type OnboardingStockRow,
  type OnboardingWorkspaceData,
  type StockStartingList,
  type StoredAccessEntry,
} from "./types";
import type { OnboardingSectionKey } from "./sections";

export type ApplianceValue = { applianceType: string; conditionNote: string; requiresClean: boolean };
export type SpecialRequestValue = { description: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; area: string };
export type ClientDataValue = { name: string; email: string; phone: string; address: string; notes: string };
export type EmergencyContactValue = { name: string; phone: string; relation: string };

export type LaundryDetailState = {
  hasLaundry: boolean;
  washerType: string | null;
  dryerType: string | null;
  laundryLocation: string | null;
  suppliesProvided: boolean;
  detergentType: string | null;
  notes: string | null;
};

/** The survey as the workspace edits it. Built by the service from one row. */
export type SurveyEditState = {
  isNewClient: boolean;
  existingClientId: string | null;
  clientData: ClientDataValue | null;
  propertyName: string | null;
  propertyAddress: string | null;
  propertySuburb: string | null;
  propertyState: string;
  propertyPostcode: string | null;
  propertyNotes: string | null;
  propertyType: string | null;
  floorCount: number;
  sizeSqm: number | null;
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  estimatedCleanerCount: number | null;
  estimatedHours: number | null;
  icalUrl: string | null;
  icalProvider: string | null;
  laundrySupplierId: string | null;
  meta: OnboardingFormMeta;
  workspace: OnboardingWorkspaceData;
  appliances: ApplianceValue[];
  specialRequests: SpecialRequestValue[];
  laundryDetail: LaundryDetailState | null;
};

export type BasicsValues = {
  propertyName: string;
  propertyAddress: string;
  propertySuburb: string;
  propertyState: string;
  propertyPostcode: string;
  propertyLatitude: number | null;
  propertyLongitude: number | null;
  propertyPlaceId: string | null;
  propertyType: string;
  floorCount: number;
  sizeSqm: number | null;
  clockInRadiusM: number | null;
  propertyNotes: string;
};

export type ClientValues = {
  isNewClient: boolean;
  existingClientId: string | null;
  clientData: ClientDataValue;
  emergencyContact: EmergencyContactValue;
};

export type RoomsValues = {
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  sofaBeds: number | null;
  roomList: OnboardingRoom[];
  roomNote: string;
  appliances: ApplianceValue[];
};

export type AccessEntryInput = {
  id: string;
  kind: OnboardingAccessKind;
  where: string;
  photos: OnboardingPhoto[];
  /** Plain text only in the request; undefined keeps the stored code, null or "" clears it. */
  code?: string | null;
};

export type AccessValues = {
  entries: AccessEntryView[];
  wifiNetwork: string;
  wifiPassword: string;
};

export type AccessPatch = {
  entries?: AccessEntryInput[];
  wifiNetwork?: string;
  wifiPassword?: string;
};

export type LaundryValues = {
  hasLaundry: boolean | null;
  laundrySupplierId: string | null;
  detergentType: string;
  washerType: string;
  dryerType: string;
  laundryLocation: string;
  linenSets: number | null;
  linenBufferSets: number | null;
  bagLabel: string;
  bagColor: string;
};

export type StockValues = {
  consumablesProvided: boolean;
  startFrom: StockStartingList | null;
  rows: OnboardingStockRow[];
};

export type ScopeValues = {
  selectedJobTypes: string[];
  specialRequests: SpecialRequestValue[];
  noGoAreas: string;
  jobTypeNotes: string;
  estimatedHours: number | null;
  estimatedCleanerCount: number | null;
};

export type PhotosValues = { roomPhotos: OnboardingRoomPhoto[] };

export type PricingValues = { rates: OnboardingRate[] };

export type CalendarValues = {
  icalUrl: string;
  icalProvider: string;
  defaultCheckinTime: string;
  defaultCheckoutTime: string;
  jobTimeSource: OnboardingJobTimeSource;
};

export type RulesValues = OnboardingHouseRules & {
  hasPets: boolean;
  petDetails: string;
  binDay: string;
  parkingInstructions: string;
  specialNotes: string;
};

export type SectionValuesMap = {
  basics: BasicsValues;
  client: ClientValues;
  rooms: RoomsValues;
  access: AccessValues;
  laundry: LaundryValues;
  stock: StockValues;
  scope: ScopeValues;
  photos: PhotosValues;
  pricing: PricingValues;
  calendar: CalendarValues;
  rules: RulesValues;
};

export type SectionPatchMap = {
  [K in OnboardingSectionKey]: K extends "access" ? AccessPatch : Partial<SectionValuesMap[K]>;
};

function scenarios(meta: OnboardingFormMeta): Record<string, unknown> {
  return meta.scenarios && typeof meta.scenarios === "object" ? (meta.scenarios as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

const EMPTY_CLIENT: ClientDataValue = { name: "", email: "", phone: "", address: "", notes: "" };

export function sectionValues(state: SurveyEditState): SectionValuesMap {
  const sc = scenarios(state.meta);
  const contact = (state.meta.emergencyContact ?? {}) as Record<string, unknown>;
  return {
    basics: {
      propertyName: state.propertyName ?? "",
      propertyAddress: state.propertyAddress ?? "",
      propertySuburb: state.propertySuburb ?? "",
      propertyState: state.propertyState,
      propertyPostcode: state.propertyPostcode ?? "",
      propertyLatitude: num(state.meta.propertyLatitude),
      propertyLongitude: num(state.meta.propertyLongitude),
      propertyPlaceId: typeof state.meta.propertyPlaceId === "string" ? state.meta.propertyPlaceId : null,
      propertyType: state.propertyType ?? "",
      floorCount: state.floorCount,
      sizeSqm: state.sizeSqm,
      clockInRadiusM: state.workspace.clockInRadiusM,
      propertyNotes: state.propertyNotes ?? "",
    },
    client: {
      isNewClient: state.isNewClient,
      existingClientId: state.existingClientId,
      clientData: state.clientData ?? { ...EMPTY_CLIENT },
      emergencyContact: { name: text(contact.name), phone: text(contact.phone), relation: text(contact.relation) },
    },
    rooms: {
      bedrooms: state.bedrooms,
      bathrooms: state.bathrooms,
      hasBalcony: state.hasBalcony,
      sofaBeds: state.workspace.rooms.sofaBeds,
      roomList: state.workspace.rooms.list,
      roomNote: state.workspace.rooms.note ?? "",
      appliances: state.appliances,
    },
    access: {
      entries: state.workspace.access.map(accessEntryView),
      wifiNetwork: text(sc.wifiNetwork),
      wifiPassword: text(sc.wifiPassword),
    },
    laundry: {
      hasLaundry: state.laundryDetail ? state.laundryDetail.hasLaundry : typeof sc.laundryAnswered === "boolean" ? false : null,
      laundrySupplierId: state.laundrySupplierId,
      detergentType: state.laundryDetail?.detergentType ?? "",
      washerType: state.laundryDetail?.washerType ?? "",
      dryerType: state.laundryDetail?.dryerType ?? "",
      laundryLocation: state.laundryDetail?.laundryLocation ?? "",
      linenSets: num(sc.linenSets),
      linenBufferSets: num(sc.linenBufferSets),
      bagLabel: state.workspace.laundry.bagLabel,
      bagColor: state.workspace.laundry.bagColor,
    },
    stock: {
      consumablesProvided: sc.consumablesProvided === true,
      startFrom: state.workspace.stock.startFrom,
      rows: state.workspace.stock.rows,
    },
    scope: {
      selectedJobTypes: Array.isArray(state.meta.selectedJobTypes) ? state.meta.selectedJobTypes : [],
      specialRequests: state.specialRequests,
      noGoAreas: text(sc.noGoAreas),
      jobTypeNotes: text(sc.jobTypeNotes),
      estimatedHours: state.estimatedHours,
      estimatedCleanerCount: state.estimatedCleanerCount,
    },
    photos: { roomPhotos: state.workspace.roomPhotos },
    pricing: { rates: state.workspace.rates },
    calendar: {
      icalUrl: state.icalUrl ?? "",
      icalProvider: state.icalProvider ?? "ICAL_OTHER",
      defaultCheckinTime: text(state.meta.defaultCheckinTime),
      defaultCheckoutTime: text(state.meta.defaultCheckoutTime),
      jobTimeSource: state.workspace.jobTimeSource,
    },
    rules: {
      hazards: state.workspace.houseRules.hazards,
      buildingRules: state.workspace.houseRules.buildingRules,
      hasPets: sc.hasPets === true,
      petDetails: text(sc.petDetails),
      binDay: text(sc.binDay),
      parkingInstructions: text(sc.parkingInstructions),
      specialNotes: text(sc.specialNotes),
    },
  };
}

export type ApplyContext = {
  source: OnboardingAnswerSource;
  actorUserId: string | null;
  now: Date;
  encrypt: (plain: string) => string;
};

export type ApplyResult = {
  next: SurveyEditState;
  /** Field → { before, after }. Codes appear only as "[encrypted]" markers. */
  changes: Record<string, { before: unknown; after: unknown }>;
  touched: { appliances: boolean; specialRequests: boolean; laundryDetail: boolean };
};

function setScenario(meta: OnboardingFormMeta, key: string, value: unknown): OnboardingFormMeta {
  const sc = { ...scenarios(meta) };
  if (value === null || value === undefined || value === "") delete sc[key];
  else sc[key] = value;
  return { ...meta, scenarios: sc };
}

function nextAccess(current: StoredAccessEntry[], inputs: AccessEntryInput[], ctx: ApplyContext): { entries: StoredAccessEntry[]; codeChanged: string[] } {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  const codeChanged: string[] = [];
  const entries = inputs.map((input) => {
    const existing = byId.get(input.id);
    let codeCipher = existing?.codeCipher ?? null;
    let codeReviewedAt = existing?.codeReviewedAt ?? null;
    let codeReviewedById = existing?.codeReviewedById ?? null;
    let source: OnboardingAnswerSource = existing?.source ?? ctx.source;
    if (input.code !== undefined) {
      const plain = (input.code ?? "").trim();
      codeCipher = plain ? ctx.encrypt(plain) : null;
      codeChanged.push(input.id);
      // A code the client types waits for the office; one the office types is reviewed by them.
      source = ctx.source;
      codeReviewedAt = ctx.source === "ADMIN_CREATED" && plain ? ctx.now.toISOString() : null;
      codeReviewedById = ctx.source === "ADMIN_CREATED" && plain ? ctx.actorUserId : null;
    }
    return {
      id: input.id,
      kind: input.kind,
      where: input.where,
      codeCipher,
      photos: input.photos.map((photo) => ({ url: photo.url, key: photo.key, source: photo.source ?? ctx.source })),
      source: existing ? source : ctx.source,
      codeReviewedAt,
      codeReviewedById,
    };
  });
  for (const entry of current) if (!inputs.some((input) => input.id === entry.id) && entry.codeCipher) codeChanged.push(entry.id);
  return { entries, codeChanged };
}

function applyBasics(state: SurveyEditState, patch: Partial<BasicsValues>): SurveyEditState {
  let next = { ...state };
  let meta = { ...state.meta };
  if (patch.propertyName !== undefined) next.propertyName = emptyToNull(patch.propertyName);
  if (patch.propertyAddress !== undefined) next.propertyAddress = emptyToNull(patch.propertyAddress);
  if (patch.propertySuburb !== undefined) next.propertySuburb = emptyToNull(patch.propertySuburb);
  if (patch.propertyState !== undefined) next.propertyState = patch.propertyState.trim() || "NSW";
  if (patch.propertyPostcode !== undefined) next.propertyPostcode = emptyToNull(patch.propertyPostcode);
  if (patch.propertyType !== undefined) next.propertyType = emptyToNull(patch.propertyType);
  if (patch.floorCount !== undefined) next.floorCount = patch.floorCount;
  if (patch.sizeSqm !== undefined) next.sizeSqm = patch.sizeSqm;
  if (patch.propertyNotes !== undefined) next.propertyNotes = emptyToNull(patch.propertyNotes);
  if (patch.propertyLatitude !== undefined) meta = { ...meta, propertyLatitude: patch.propertyLatitude };
  if (patch.propertyLongitude !== undefined) meta = { ...meta, propertyLongitude: patch.propertyLongitude };
  if (patch.propertyPlaceId !== undefined) meta = { ...meta, propertyPlaceId: patch.propertyPlaceId };
  next.meta = meta;
  if (patch.clockInRadiusM !== undefined) next = { ...next, workspace: { ...next.workspace, clockInRadiusM: patch.clockInRadiusM } };
  return next;
}

function applyClient(state: SurveyEditState, patch: Partial<ClientValues>): SurveyEditState {
  const next = { ...state };
  if (patch.isNewClient !== undefined) next.isNewClient = patch.isNewClient;
  if (patch.existingClientId !== undefined) next.existingClientId = patch.existingClientId || null;
  if (patch.clientData !== undefined) next.clientData = patch.clientData.name.trim() || patch.clientData.email.trim() || patch.clientData.phone.trim() ? patch.clientData : null;
  if (patch.emergencyContact !== undefined) next.meta = { ...next.meta, emergencyContact: patch.emergencyContact };
  return next;
}

function applyRooms(state: SurveyEditState, patch: Partial<RoomsValues>): SurveyEditState {
  let next = { ...state };
  if (patch.bedrooms !== undefined) next.bedrooms = patch.bedrooms;
  if (patch.bathrooms !== undefined) next.bathrooms = patch.bathrooms;
  if (patch.hasBalcony !== undefined) next.hasBalcony = patch.hasBalcony;
  if (patch.appliances !== undefined) next.appliances = patch.appliances;
  const rooms = { ...next.workspace.rooms };
  if (patch.sofaBeds !== undefined) rooms.sofaBeds = patch.sofaBeds;
  if (patch.roomList !== undefined) rooms.list = patch.roomList;
  if (patch.roomNote !== undefined) {
    // The note IS the old bed configuration text: one value, kept in both places.
    rooms.note = emptyToNull(patch.roomNote);
    next.meta = setScenario(next.meta, "bedConfig", emptyToNull(patch.roomNote));
  }
  next = { ...next, workspace: { ...next.workspace, rooms } };
  return next;
}

function applyLaundry(state: SurveyEditState, patch: Partial<LaundryValues>): SurveyEditState {
  let next = { ...state };
  if (patch.laundrySupplierId !== undefined) next.laundrySupplierId = patch.laundrySupplierId || null;
  const detailTouched = ["hasLaundry", "detergentType", "washerType", "dryerType", "laundryLocation"].some((key) => key in patch);
  if (detailTouched) {
    const base: LaundryDetailState = next.laundryDetail ?? { hasLaundry: false, washerType: null, dryerType: null, laundryLocation: null, suppliesProvided: false, detergentType: null, notes: null };
    const hasLaundry = patch.hasLaundry !== undefined ? patch.hasLaundry === true : base.hasLaundry;
    next.laundryDetail = {
      ...base,
      hasLaundry,
      detergentType: patch.detergentType !== undefined ? emptyToNull(patch.detergentType) : base.detergentType,
      washerType: patch.washerType !== undefined ? emptyToNull(patch.washerType) : base.washerType,
      dryerType: patch.dryerType !== undefined ? emptyToNull(patch.dryerType) : base.dryerType,
      laundryLocation: patch.laundryLocation !== undefined ? emptyToNull(patch.laundryLocation) : base.laundryLocation,
    };
    // "No laundry" is an answer too: remember it was answered (the detail row is not stored when off).
    if (patch.hasLaundry !== undefined) next.meta = setScenario(next.meta, "laundryAnswered", patch.hasLaundry === null ? null : true);
  }
  if (patch.linenSets !== undefined) next.meta = setScenario(next.meta, "linenSets", patch.linenSets);
  if (patch.linenBufferSets !== undefined) next.meta = setScenario(next.meta, "linenBufferSets", patch.linenBufferSets);
  if (patch.bagLabel !== undefined || patch.bagColor !== undefined) {
    next = {
      ...next,
      workspace: {
        ...next.workspace,
        laundry: {
          bagLabel: patch.bagLabel ?? next.workspace.laundry.bagLabel,
          bagColor: patch.bagColor ?? next.workspace.laundry.bagColor,
        },
      },
    };
  }
  return next;
}

function applyScope(state: SurveyEditState, patch: Partial<ScopeValues>): SurveyEditState {
  const next = { ...state };
  if (patch.selectedJobTypes !== undefined) next.meta = { ...next.meta, selectedJobTypes: patch.selectedJobTypes };
  if (patch.specialRequests !== undefined) next.specialRequests = patch.specialRequests;
  if (patch.noGoAreas !== undefined) next.meta = setScenario(next.meta, "noGoAreas", emptyToNull(patch.noGoAreas));
  if (patch.jobTypeNotes !== undefined) next.meta = setScenario(next.meta, "jobTypeNotes", emptyToNull(patch.jobTypeNotes));
  if (patch.estimatedHours !== undefined) next.estimatedHours = patch.estimatedHours;
  if (patch.estimatedCleanerCount !== undefined) next.estimatedCleanerCount = patch.estimatedCleanerCount;
  return next;
}

function applyCalendar(state: SurveyEditState, patch: Partial<CalendarValues>): SurveyEditState {
  let next = { ...state };
  if (patch.icalUrl !== undefined) next.icalUrl = emptyToNull(patch.icalUrl);
  if (patch.icalProvider !== undefined) next.icalProvider = patch.icalProvider || "ICAL_OTHER";
  if (patch.defaultCheckinTime !== undefined) next.meta = { ...next.meta, defaultCheckinTime: emptyToNull(patch.defaultCheckinTime) };
  if (patch.defaultCheckoutTime !== undefined) next.meta = { ...next.meta, defaultCheckoutTime: emptyToNull(patch.defaultCheckoutTime) };
  if (patch.jobTimeSource !== undefined) next = { ...next, workspace: { ...next.workspace, jobTimeSource: patch.jobTimeSource } };
  return next;
}

function applyRules(state: SurveyEditState, patch: Partial<RulesValues>): SurveyEditState {
  let next = { ...state };
  if (patch.hasPets !== undefined) next.meta = setScenario(next.meta, "hasPets", patch.hasPets ? true : null);
  if (patch.petDetails !== undefined) next.meta = setScenario(next.meta, "petDetails", emptyToNull(patch.petDetails));
  if (patch.binDay !== undefined) next.meta = setScenario(next.meta, "binDay", emptyToNull(patch.binDay));
  if (patch.parkingInstructions !== undefined) next.meta = setScenario(next.meta, "parkingInstructions", emptyToNull(patch.parkingInstructions));
  if (patch.specialNotes !== undefined) next.meta = setScenario(next.meta, "specialNotes", emptyToNull(patch.specialNotes));
  if (patch.hazards !== undefined || patch.buildingRules !== undefined) {
    next = {
      ...next,
      workspace: {
        ...next.workspace,
        houseRules: {
          hazards: patch.hazards ?? next.workspace.houseRules.hazards,
          buildingRules: patch.buildingRules ?? next.workspace.houseRules.buildingRules,
        },
      },
    };
  }
  return next;
}

function diff(before: Record<string, unknown>, after: Record<string, unknown>, section: string): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[`${section}.${key}`] = { before: clip(before[key]), after: clip(after[key]) };
  }
  return out;
}

function clip(value: unknown): unknown {
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  const json = JSON.stringify(value);
  if (json && json.length > 4000) return { summary: `${Array.isArray(value) ? value.length + " items" : "value"} (too long to keep in history)` };
  return value;
}

/**
 * Apply one section's patch. Only the fields present in the patch change, so
 * two people editing different fields of the same step never overwrite each
 * other. Lists (rooms, access entries, photos, rates, stock rows) are replaced
 * as a whole.
 */
export function applySectionPatch<K extends OnboardingSectionKey>(state: SurveyEditState, section: K, patch: SectionPatchMap[K], ctx: ApplyContext): ApplyResult {
  const beforeValues = sectionValues(state)[section] as Record<string, unknown>;
  let next: SurveyEditState = state;
  let codeChanged: string[] = [];
  switch (section) {
    case "basics":
      next = applyBasics(state, patch as Partial<BasicsValues>);
      break;
    case "client":
      next = applyClient(state, patch as Partial<ClientValues>);
      break;
    case "rooms":
      next = applyRooms(state, patch as Partial<RoomsValues>);
      break;
    case "access": {
      const accessPatch = patch as AccessPatch;
      next = { ...state };
      if (accessPatch.entries !== undefined) {
        const result = nextAccess(state.workspace.access, accessPatch.entries, ctx);
        codeChanged = result.codeChanged;
        next = { ...next, workspace: { ...next.workspace, access: result.entries } };
      }
      if (accessPatch.wifiNetwork !== undefined) next.meta = setScenario(next.meta, "wifiNetwork", emptyToNull(accessPatch.wifiNetwork));
      if (accessPatch.wifiPassword !== undefined) next.meta = setScenario(next.meta, "wifiPassword", emptyToNull(accessPatch.wifiPassword));
      break;
    }
    case "laundry":
      next = applyLaundry(state, patch as Partial<LaundryValues>);
      break;
    case "stock": {
      const stockPatch = patch as Partial<StockValues>;
      next = { ...state };
      if (stockPatch.consumablesProvided !== undefined) next.meta = setScenario(next.meta, "consumablesProvided", stockPatch.consumablesProvided ? true : null);
      if (stockPatch.startFrom !== undefined || stockPatch.rows !== undefined) {
        next = {
          ...next,
          workspace: {
            ...next.workspace,
            stock: {
              startFrom: stockPatch.startFrom !== undefined ? stockPatch.startFrom : next.workspace.stock.startFrom,
              rows: stockPatch.rows ?? next.workspace.stock.rows,
            },
          },
        };
      }
      break;
    }
    case "scope":
      next = applyScope(state, patch as Partial<ScopeValues>);
      break;
    case "photos": {
      const photosPatch = patch as Partial<PhotosValues>;
      next = photosPatch.roomPhotos ? { ...state, workspace: { ...state.workspace, roomPhotos: photosPatch.roomPhotos } } : state;
      break;
    }
    case "pricing": {
      const pricingPatch = patch as Partial<PricingValues>;
      next = pricingPatch.rates ? { ...state, workspace: { ...state.workspace, rates: pricingPatch.rates } } : state;
      break;
    }
    case "calendar":
      next = applyCalendar(state, patch as Partial<CalendarValues>);
      break;
    case "rules":
      next = applyRules(state, patch as Partial<RulesValues>);
      break;
  }
  const afterValues = sectionValues(next)[section] as Record<string, unknown>;
  const changes = diff(beforeValues, afterValues, section);
  if (section === "access") {
    // The view only says whether a code exists; record a code change explicitly, never its value.
    for (const id of codeChanged) changes[`access.code.${id}`] = { before: "[encrypted]", after: "[encrypted]" };
    if (changes["access.wifiPassword"]) changes["access.wifiPassword"] = { before: "[hidden]", after: "[hidden]" };
  }
  return {
    next,
    changes,
    touched: {
      appliances: section === "rooms" && "appliances" in (patch as object),
      specialRequests: section === "scope" && "specialRequests" in (patch as object),
      laundryDetail: section === "laundry" && ["hasLaundry", "detergentType", "washerType", "dryerType", "laundryLocation"].some((key) => key in (patch as object)),
    },
  };
}

/** Mark or unmark a recommended section as skipped. */
export function setSkipped(state: SurveyEditState, section: OnboardingSectionKey, skipped: boolean): SurveyEditState {
  const current = new Set(state.workspace.skipped);
  if (skipped) current.add(section);
  else current.delete(section);
  return { ...state, workspace: { ...state.workspace, skipped: Array.from(current) } };
}
