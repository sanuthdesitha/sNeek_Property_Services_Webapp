import { z } from "zod";
import {
  optionalAddressSchema,
  optionalEmailSchema,
  optionalAustralianMobileSchema,
  optionalNoteSchema,
  optionalPostcodeSchema,
  requiredAddressSchema,
  requiredAustralianStateSchema,
  requiredSuburbSchema,
} from "@/lib/validations/common";

const accessAttachmentSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
  key: z.string().optional(),
  contentType: z.string().optional(),
});

const accessInfoSchema = z.object({
  lockbox: z.string().optional(),
  codes: z.string().optional(),
  parking: z.string().optional(),
  other: z.string().optional(),
  instructions: z.string().optional(),
  defaultCleanDurationHours: z.number().positive().max(24).optional(),
  maxGuestCount: z.number().int().min(1).max(100).optional(),
  laundryTeamUserIds: z.array(z.string().cuid()).optional(),
  attachments: z.array(accessAttachmentSchema).optional(),
});

const inventoryLocationSchema = z.enum(["BATHROOM", "KITCHEN", "CLEANERS_CUPBOARD"]);

export const createClientSchema = z.object({
  name: z.string().trim().min(1, "Client name is required.").max(200, "Client name is too long."),
  email: optionalEmailSchema,
  phone: optionalAustralianMobileSchema,
  address: optionalAddressSchema,
  notes: optionalNoteSchema(4000),
  sendPortalInvite: z.boolean().optional(),
  welcomeNote: z.string().max(4000).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const createPropertySchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1, "Property name is required.").max(200, "Property name is too long."),
  address: requiredAddressSchema,
  suburb: requiredSuburbSchema,
  state: requiredAustralianStateSchema.default("NSW"),
  postcode: optionalPostcodeSchema,
  notes: optionalNoteSchema(4000),
  accessInfo: accessInfoSchema.optional(),
  linenBufferSets: z.number().int().min(0).default(0),
  inventoryEnabled: z.boolean().default(false),
  defaultCheckinTime: z.string().regex(/^\d{2}:\d{2}$/).default("14:00"),
  defaultCheckoutTime: z.string().regex(/^\d{2}:\d{2}$/).default("10:00"),
  hasBalcony: z.boolean().default(false),
  bedrooms: z.number().int().min(0).default(1),
  bathrooms: z.number().int().min(0).default(1),
  defaultInventoryItemIds: z.array(z.string().cuid()).optional(),
  customInventoryItems: z
    .array(
      z.object({
        name: z.string().min(1),
        category: z.string().min(1).default("Custom"),
        location: inventoryLocationSchema.default("CLEANERS_CUPBOARD"),
        unit: z.string().min(1).default("unit"),
        supplier: z.string().optional(),
        onHand: z.number().min(0).default(0),
        parLevel: z.number().min(0).default(6),
        reorderThreshold: z.number().min(0).default(2),
      })
    )
    .optional(),
});

export const updatePropertySchema = createPropertySchema.partial().omit({ clientId: true });

export const updateIntegrationSchema = z.object({
  icalUrl: z.string().url().optional().nullable(),
  isEnabled: z.boolean().optional(),
  notes: z.string().optional(),
  syncOptions: z
    .object({
      ignorePastDates: z.boolean().optional(),
      autoCreateTurnoverJobs: z.boolean().optional(),
      updateExistingLinkedJobs: z.boolean().optional(),
      verifyFeedDuplicates: z.boolean().optional(),
      verifyExistingJobConflicts: z.boolean().optional(),
    })
    .optional(),
});
