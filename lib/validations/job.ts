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

export const createJobSchema = z.object({
  propertyId: z.string().min(1),
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
});

export const updateJobSchema = createJobSchema.partial().extend({
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
