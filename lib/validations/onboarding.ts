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

export const createSurveySchema = z.object({
  isNewClient: z.boolean().optional(),
  clientData: z
    .object({
      name: z.string().trim().min(1),
      email: z.string().email().optional().nullable(),
      phone: z.string().trim().optional().nullable(),
      address: z.string().trim().optional().nullable(),
      notes: z.string().trim().optional().nullable(),
    })
    .optional()
    .nullable(),
  existingClientId: z.string().trim().min(1).optional().nullable(),
  propertyAddress: z.string().trim().optional().nullable(),
  propertySuburb: z.string().trim().optional().nullable(),
  propertyState: z.string().trim().default("NSW"),
  propertyPostcode: z.string().trim().optional().nullable(),
  propertyName: z.string().trim().optional().nullable(),
  propertyNotes: z.string().trim().optional().nullable(),
  bedrooms: z.number().int().min(0).max(50).default(1),
  bathrooms: z.number().int().min(0).max(50).default(1),
  hasBalcony: z.boolean().default(false),
  floorCount: z.number().int().min(1).max(20).default(1),
  propertyType: z.string().trim().optional().nullable(),
  sizeSqm: z.number().positive().max(50000).optional().nullable(),
  requestedCleanerCount: z.number().int().min(1).max(20).default(1),
  icalUrl: z.string().trim().url().optional().nullable(),
  icalProvider: z.enum(["ICAL_HOSPITABLE", "ICAL_OTHER"]).optional().nullable(),
  laundrySupplierId: z.string().trim().min(1).optional().nullable(),
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
