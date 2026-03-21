import { z } from "zod";
import { JobType, JobStatus } from "@prisma/client";

const timeRuleSchema = z.object({
  enabled: z.boolean().optional(),
  preset: z.enum(["none", "11:00", "12:30", "custom"]).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const attachmentSchema = z.object({
  key: z.string().min(1),
  url: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
});

const serviceContextSchema = z.object({
  scopeOfWork: z.string().max(4000).optional(),
  accessInstructions: z.string().max(4000).optional(),
  parkingInstructions: z.string().max(4000).optional(),
  hazardNotes: z.string().max(4000).optional(),
  equipmentNotes: z.string().max(4000).optional(),
  siteContactName: z.string().max(200).optional(),
  siteContactPhone: z.string().max(80).optional(),
  serviceAreaSqm: z.number().positive().max(100000).optional(),
  floorCount: z.number().int().min(1).max(200).optional(),
});

const serviceSiteSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  suburb: z.string().min(1),
  state: z.string().max(80).optional(),
  postcode: z.string().max(20).optional(),
  bedrooms: z.number().int().min(0).max(200).optional(),
  bathrooms: z.number().int().min(0).max(200).optional(),
  hasBalcony: z.boolean().optional(),
});

const baseCreateJobSchema = z.object({
  propertyId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  jobType: z.nativeEnum(JobType),
  scheduledDate: z.string().datetime(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  estimatedHours: z.number().positive().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  isDraft: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  attachments: z.array(attachmentSchema).optional(),
  transportAllowances: z.record(z.string().min(1), z.number().nonnegative()).optional(),
  earlyCheckin: timeRuleSchema.optional(),
  lateCheckout: timeRuleSchema.optional(),
  reservationId: z.string().min(1).optional(),
  serviceSite: serviceSiteSchema.optional(),
  serviceContext: serviceContextSchema.optional(),
});

export const createJobSchema = baseCreateJobSchema.superRefine((data, ctx) => {
    if (data.jobType === JobType.AIRBNB_TURNOVER && !data.propertyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Property is required for Airbnb turnover jobs.",
        path: ["propertyId"],
      });
    }

    if (data.jobType !== JobType.AIRBNB_TURNOVER && !data.propertyId && !data.serviceSite) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose an existing property or provide a service site.",
        path: ["serviceSite"],
      });
    }
  });

export const updateJobSchema = baseCreateJobSchema.partial().extend({
  status: z.nativeEnum(JobStatus).optional(),
});

export const assignJobSchema = z.object({
  userIds: z.array(z.string().min(1)),
  primaryUserId: z.string().min(1).optional(),
  confirmCompletedReset: z.boolean().optional(),
});

export const submitJobSchema = z.object({
  templateId: z.string().min(1),
  data: z.record(z.unknown()),
  laundryReady: z.boolean().optional(),
  bagLocation: z.string().optional(),
});
