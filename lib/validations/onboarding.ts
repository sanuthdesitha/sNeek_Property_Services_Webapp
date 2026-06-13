import { z } from "zod";

export const applianceSchema = z.object({
  id: z.string().optional(),
  applianceType: z.string().trim().min(1),
  conditionNote: z.string().trim().max(2000).optional().nullable(),
  requiresClean: z.boolean().default(true),
});

export const specialRequestSchema = z.object({
  id: z.string().optional(),
  description: z.string().trim().min(1).max(2000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  area: z.string().trim().max(100).optional().nullable(),
});

export const laundryDetailSchema = z.object({
  id: z.string().optional(),
  hasLaundry: z.boolean().default(false),
  washerType: z.string().trim().optional().nullable(),
  dryerType: z.string().trim().optional().nullable(),
  laundryLocation: z.string().trim().optional().nullable(),
  suppliesProvided: z.boolean().default(false),
  detergentType: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const accessDetailSchema = z.object({
  id: z.string().optional(),
  detailType: z.string().trim().min(1),
  value: z.string().trim().max(2000).optional().nullable(),
  photoUrl: z.string().trim().optional().nullable(),
  photoKey: z.string().trim().optional().nullable(),
  annotations: z.array(z.object({ x: z.number(), y: z.number(), text: z.string() })).optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
});

export const jobTypeAnswerSchema = z.object({
  id: z.string().optional(),
  jobType: z.string().trim().min(1),
  answers: z.record(z.string(), z.unknown()),
  isComplete: z.boolean().default(false),
});

// ─────────────────────────────────────────────
// Structured scenario fields (stored in propertyNotes JSON envelope's
// `scenarios` key + adminOverrides). The Prisma schema has no dedicated
// columns for these so we keep them as a validated JSON blob carried on the
// survey via the `scenarios` field, which the API folds into propertyNotes.
// Everything here is optional-friendly so drafts never block.
// ─────────────────────────────────────────────
export const scenarioSchema = z
  .object({
    // Rooms / config
    bedConfig: z.string().trim().max(500).optional().nullable(), // e.g. "2x Queen, 1x King, 2x Single"
    bedCount: z.number().int().min(0).max(100).optional().nullable(),
    // Pets
    hasPets: z.boolean().optional(),
    petDetails: z.string().trim().max(500).optional().nullable(),
    // Security / alarm
    hasAlarm: z.boolean().optional(),
    alarmCode: z.string().trim().max(200).optional().nullable(),
    alarmNotes: z.string().trim().max(1000).optional().nullable(),
    // Wifi
    wifiNetwork: z.string().trim().max(200).optional().nullable(),
    wifiPassword: z.string().trim().max(200).optional().nullable(),
    // Bins / recycling
    binDay: z.string().trim().max(100).optional().nullable(), // e.g. "Tuesday — recycling fortnightly"
    binNotes: z.string().trim().max(1000).optional().nullable(),
    // Consumables / restock expectations
    consumablesProvided: z.boolean().optional(),
    consumablesNotes: z.string().trim().max(2000).optional().nullable(),
    restockExpectations: z.string().trim().max(2000).optional().nullable(),
    // Linen par levels (laundry-adjacent)
    linenSets: z.number().int().min(0).max(100).optional().nullable(),
    linenBufferSets: z.number().int().min(0).max(100).optional().nullable(),
    linenNotes: z.string().trim().max(1000).optional().nullable(),
    // No-go areas / off-limits
    noGoAreas: z.string().trim().max(2000).optional().nullable(),
    // Free-text notes captured in the Notes step
    parkingInstructions: z.string().trim().max(2000).optional().nullable(),
    timingInstructions: z.string().trim().max(2000).optional().nullable(),
    specialNotes: z.string().trim().max(4000).optional().nullable(),
    jobTypeNotes: z.string().trim().max(4000).optional().nullable(),
  })
  .partial();

export const recurringScheduleSchema = z
  .object({
    enabled: z.boolean().optional(),
    cadence: z.enum(["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ON_DEMAND", "CUSTOM"]).optional().nullable(),
    dayOfWeek: z.number().int().min(0).max(6).optional().nullable(),
    preferredTime: z
      .string()
      .trim()
      .regex(/^\d{2}:\d{2}$/, "Use HH:mm")
      .optional()
      .nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .partial();

export const emergencyContactSchema = z
  .object({
    name: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    relation: z.string().trim().max(100).optional().nullable(),
    email: z.string().trim().max(200).optional().nullable(),
  })
  .partial();

export const createSurveySchema = z.object({
  isNewClient: z.boolean().optional(),
  clientData: z
    .object({
      name: z.string().trim().min(1),
      email: z.string().email().optional().nullable(),
      phone: z.string().trim().optional().nullable(),
      address: z.string().trim().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
      // Carried from address autocomplete so the created Client is geocoded too.
      suburb: z.string().trim().optional().nullable(),
      state: z.string().trim().optional().nullable(),
      postcode: z.string().trim().optional().nullable(),
      latitude: z.number().optional().nullable(),
      longitude: z.number().optional().nullable(),
      placeId: z.string().trim().optional().nullable(),
    })
    .passthrough()
    .optional()
    .nullable(),
  existingClientId: z.string().trim().min(1).optional().nullable(),
  propertyAddress: z.string().trim().optional().nullable(),
  propertySuburb: z.string().trim().optional().nullable(),
  propertyState: z.string().trim().default("NSW"),
  propertyPostcode: z.string().trim().optional().nullable(),
  propertyName: z.string().trim().optional().nullable(),
  propertyNotes: z.string().trim().optional().nullable(),
  // Geocode carried from the address autocomplete; persisted so the created
  // Property has lat/lng/placeId for maps + GPS check-in.
  propertyLatitude: z.number().optional().nullable(),
  propertyLongitude: z.number().optional().nullable(),
  propertyPlaceId: z.string().trim().optional().nullable(),
  bedrooms: z.number().int().min(0).max(50).default(1),
  bathrooms: z.number().int().min(0).max(50).default(1),
  hasBalcony: z.boolean().default(false),
  floorCount: z.number().int().min(1).max(20).default(1),
  propertyType: z.string().trim().optional().nullable(),
  sizeSqm: z.number().positive().max(50000).optional().nullable(),
  requestedCleanerCount: z.number().int().min(1).max(20).default(1),
  estimatedCleanerCount: z.number().int().min(0).max(50).optional().nullable(),
  estimatedHours: z.number().min(0).max(1000).optional().nullable(),
  estimatedPrice: z.number().min(0).max(1_000_000).optional().nullable(),
  defaultCheckinTime: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm")
    .optional()
    .nullable(),
  defaultCheckoutTime: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, "Use HH:mm")
    .optional()
    .nullable(),
  preferredCleanerUserId: z.string().trim().min(1).optional().nullable(),
  icalUrl: z.string().trim().url().optional().nullable(),
  icalProvider: z.enum(["ICAL_HOSPITABLE", "ICAL_OTHER"]).optional().nullable(),
  laundrySupplierId: z.string().trim().min(1).optional().nullable(),
  // Structured scenario blobs + selected cleaning types.
  selectedJobTypes: z.array(z.string().trim().min(1)).optional().default([]),
  scenarios: scenarioSchema.optional().nullable(),
  recurringSchedule: recurringScheduleSchema.optional().nullable(),
  emergencyContact: emergencyContactSchema.optional().nullable(),
  appliances: z.array(applianceSchema).optional().default([]),
  specialRequests: z.array(specialRequestSchema).optional().default([]),
  laundryDetail: laundryDetailSchema.optional().nullable(),
  accessDetails: z.array(accessDetailSchema).optional().default([]),
  jobTypeAnswers: z.array(jobTypeAnswerSchema).optional().default([]),
});

export const updateSurveySchema = createSurveySchema.partial();

export const estimateInputSchema = z.object({
  bedrooms: z.number().int().min(0).default(1),
  bathrooms: z.number().int().min(0).default(1),
  hasBalcony: z.boolean().default(false),
  floorCount: z.number().int().min(1).default(1),
  propertyType: z.string().nullable(),
  sizeSqm: z.number().positive().nullable(),
  applianceCount: z.number().int().min(0).default(0),
  specialRequestCount: z.number().int().min(0).default(0),
  conditionLevel: z.enum(["light", "standard", "heavy"]).default("standard"),
  selectedJobTypes: z.array(z.string()).default([]),
  laundryEnabled: z.boolean().default(false),
});

export const icalValidateSchema = z.object({
  icalUrl: z.string().trim().url(),
});

// Admin approve payload. Overrides are optional and folded into the
// adminOverrides JSON; createJobsForTypes lets the reviewer pick which job
// drafts to spin up.
export const approveSurveySchema = z.object({
  adminNotes: z.string().trim().max(4000).optional().nullable(),
  adminOverrides: z
    .object({
      estimatedHours: z.number().min(0).max(1000).optional().nullable(),
      cleanerCount: z.number().int().min(0).max(50).optional().nullable(),
      estimatedPrice: z.number().min(0).max(1_000_000).optional().nullable(),
      fixedPrice: z.number().min(0).max(1_000_000).optional().nullable(),
    })
    .passthrough()
    .optional()
    .nullable(),
  createJobsForTypes: z.array(z.string().trim().min(1)).optional(),
  createInitialJobs: z.boolean().optional(),
});
