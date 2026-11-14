/**
 * Request validation for workspace saves (office) and client-link saves.
 * Every field is optional: a save carries only the fields that changed.
 */
import { z } from "zod";
import { JobType } from "@prisma/client";
import { ACCESS_KINDS } from "./types";
import { CLIENT_LINK_MAX_DAYS, CLIENT_LINK_SECTIONS, ONBOARDING_SECTION_KEYS } from "./sections";

const shortText = z.string().max(300);
const longText = z.string().max(4000);
const hhmm = z.string().regex(/^(?:|\d{2}:\d{2})$/, "Use HH:mm");
const money = z.number().min(0.01).max(100_000).nullable();
const count = z.number().int().min(0).max(500).nullable();
const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const photoSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  key: z.string().trim().min(1).max(500),
  source: z.enum(["ADMIN_CREATED", "CLIENT_SUBMITTED"]).optional(),
});

const clientDataSchema = z.object({
  name: shortText,
  email: z.union([z.literal(""), z.string().trim().email().max(200)]),
  phone: z.string().max(50),
  address: shortText,
  notes: longText,
});

export const basicsPatchSchema = z
  .object({
    propertyName: shortText,
    propertyAddress: shortText,
    propertySuburb: z.string().max(120),
    propertyState: z.string().max(20),
    propertyPostcode: z.string().max(12),
    propertyLatitude: z.number().min(-90).max(90).nullable(),
    propertyLongitude: z.number().min(-180).max(180).nullable(),
    propertyPlaceId: z.string().max(300).nullable(),
    propertyType: z.string().max(40),
    floorCount: z.number().int().min(1).max(20),
    sizeSqm: z.number().positive().max(50_000).nullable(),
    clockInRadiusM: z.number().int().min(50).max(2000).nullable(),
    propertyNotes: longText,
  })
  .partial()
  .strict();

export const clientPatchSchema = z
  .object({
    isNewClient: z.boolean(),
    existingClientId: z.string().trim().max(64).nullable(),
    clientData: clientDataSchema,
    emergencyContact: z.object({ name: shortText, phone: z.string().max(50), relation: z.string().max(100) }),
  })
  .partial()
  .strict();

const roomSchema = z.object({
  id,
  name: z.string().max(120),
  kind: z.enum(["BEDROOM", "BATHROOM", "LIVING", "KITCHEN", "OTHER"]),
  beds: z.string().max(200),
  notes: z.string().max(500),
});

const applianceSchema = z.object({ applianceType: z.string().trim().min(1).max(40), conditionNote: z.string().max(1000), requiresClean: z.boolean() });

export const roomsPatchSchema = z
  .object({
    bedrooms: z.number().int().min(0).max(50),
    bathrooms: z.number().int().min(0).max(50),
    hasBalcony: z.boolean(),
    sofaBeds: count,
    roomList: z.array(roomSchema).max(60),
    roomNote: z.string().max(500),
    appliances: z.array(applianceSchema).max(30),
  })
  .partial()
  .strict();

const accessEntrySchema = z.object({
  id,
  kind: z.enum(ACCESS_KINDS as unknown as [string, ...string[]]),
  where: z.string().max(1000),
  photos: z.array(photoSchema).max(10),
  code: z.string().max(200).nullable().optional(),
});

export const accessPatchSchema = z
  .object({
    entries: z.array(accessEntrySchema).max(30),
    wifiNetwork: z.string().max(200),
    wifiPassword: z.string().max(200),
  })
  .partial()
  .strict();

export const laundryPatchSchema = z
  .object({
    hasLaundry: z.boolean().nullable(),
    laundrySupplierId: z.string().trim().max(64).nullable(),
    detergentType: z.string().max(40),
    washerType: z.string().max(40),
    dryerType: z.string().max(40),
    laundryLocation: z.string().max(40),
    linenSets: count,
    linenBufferSets: count,
    bagLabel: z.string().max(60),
    bagColor: z.string().max(40),
  })
  .partial()
  .strict();

const stockRowSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().max(120),
  unit: z.string().max(40),
  parLevel: z.number().min(0).max(10_000).nullable(),
  reorderAt: z.number().min(0).max(10_000).nullable(),
});

export const stockPatchSchema = z
  .object({
    consumablesProvided: z.boolean(),
    startFrom: z.enum(["ONE_BED", "TWO_BED", "THREE_PLUS"]).nullable(),
    rows: z.array(stockRowSchema).max(80),
  })
  .partial()
  .strict();

const jobTypeSchema = z.nativeEnum(JobType);

export const scopePatchSchema = z
  .object({
    selectedJobTypes: z.array(jobTypeSchema).max(20),
    specialRequests: z.array(z.object({ description: z.string().trim().min(1).max(2000), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]), area: z.string().max(100) })).max(40),
    noGoAreas: longText,
    jobTypeNotes: longText,
    estimatedHours: z.number().min(0).max(1000).nullable(),
    estimatedCleanerCount: z.number().int().min(0).max(50).nullable(),
  })
  .partial()
  .strict();

const roomPhotoSchema = z.object({
  id,
  room: z.string().max(120),
  caption: z.string().max(300),
  photo: photoSchema.nullable(),
  askedOfClient: z.boolean(),
});

export const photosPatchSchema = z.object({ roomPhotos: z.array(roomPhotoSchema).max(60) }).partial().strict();

export const pricingPatchSchema = z
  .object({
    rates: z
      .array(
        z.object({
          jobType: jobTypeSchema,
          clientRate: money,
          billingUnit: z.enum(["PER_JOB", "PER_HOUR"]),
          cleanerPayMode: z.enum(["PER_CLEAN", "HOURLY"]),
          cleanerPay: money,
        }),
      )
      .max(20),
  })
  .partial()
  .strict();

export const calendarPatchSchema = z
  .object({
    icalUrl: z.union([z.literal(""), z.string().trim().url().max(2000)]),
    icalProvider: z.enum(["ICAL_HOSPITABLE", "ICAL_OTHER"]),
    defaultCheckinTime: hhmm,
    defaultCheckoutTime: hhmm,
    jobTimeSource: z.enum(["PROPERTY", "ICAL"]),
  })
  .partial()
  .strict();

export const rulesPatchSchema = z
  .object({
    hazards: longText,
    buildingRules: longText,
    hasPets: z.boolean(),
    petDetails: z.string().max(500),
    binDay: z.string().max(200),
    parkingInstructions: z.string().max(2000),
    specialNotes: longText,
  })
  .partial()
  .strict();

export const SECTION_PATCH_SCHEMAS = {
  basics: basicsPatchSchema,
  client: clientPatchSchema,
  rooms: roomsPatchSchema,
  access: accessPatchSchema,
  laundry: laundryPatchSchema,
  stock: stockPatchSchema,
  scope: scopePatchSchema,
  photos: photosPatchSchema,
  pricing: pricingPatchSchema,
  calendar: calendarPatchSchema,
  rules: rulesPatchSchema,
} as const;

export const workspaceSaveSchema = z.object({
  section: z.enum(ONBOARDING_SECTION_KEYS),
  values: z.record(z.string(), z.unknown()),
  baseRevision: z.number().int().min(0),
  skipped: z.boolean().optional(),
});

export const activateSchema = z.object({
  createInitialJobs: z.boolean(),
  baseRevision: z.number().int().min(0),
});

export const clientLinkCreateSchema = z.object({
  sections: z.array(z.enum(CLIENT_LINK_SECTIONS)).min(1).max(CLIENT_LINK_SECTIONS.length),
  transport: z.enum(["EMAIL", "SMS"]),
  recipient: z.string().trim().min(3).max(200),
  days: z.number().int().min(1).max(CLIENT_LINK_MAX_DAYS),
  idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
});

/** What the client's page may save: only the client parts, only their fields. */
export const clientSaveSchema = z.discriminatedUnion("section", [
  z.object({
    section: z.literal("access"),
    entries: z
      .array(z.object({ id, kind: z.enum(ACCESS_KINDS as unknown as [string, ...string[]]), where: z.string().max(1000), code: z.string().max(200).nullable().optional(), photos: z.array(photoSchema.omit({ source: true })).max(10) }))
      .max(15),
  }),
  z.object({ section: z.literal("photos"), photos: z.array(z.object({ id, photo: photoSchema.omit({ source: true }).nullable() })).max(60) }),
  z.object({
    section: z.literal("rules"),
    values: z.object({ hazards: longText, buildingRules: longText, hasPets: z.boolean(), petDetails: z.string().max(500), binDay: z.string().max(200), parkingInstructions: z.string().max(2000) }).partial().strict(),
  }),
  z.object({ section: z.literal("linen"), values: z.object({ linenSets: count, linenBufferSets: count }).partial().strict() }),
  z.object({ section: z.literal("calendar"), icalUrl: z.union([z.literal(""), z.string().trim().url().max(2000)]) }),
]);

export const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
