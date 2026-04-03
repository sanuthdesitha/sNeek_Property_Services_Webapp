import { z } from "zod";
import { JobType } from "@prisma/client";
import { marketedJobTypeSchema } from "@/lib/marketing/job-types";
import {
  optionalAddressSchema,
  optionalAustralianPhoneSchema,
  optionalSuburbSchema,
  requiredEmailSchema,
  requiredNameSchema,
} from "@/lib/validations/common";

export const publicQuoteSchema = z.object({
  serviceType: marketedJobTypeSchema,
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().int().min(0).max(20).optional(),
  floors: z.number().int().min(1).max(10).default(1),
  areaBand: z.enum(["compact", "standard", "large", "extra_large"]).default("standard"),
  areaSqm: z.number().min(0).max(5000).optional(),
  serviceUnits: z.number().min(0).max(500).optional(),
  windowCount: z.number().int().min(0).max(500).optional(),
  windowAccess: z.enum(["minimal", "standard", "extensive"]).default("standard"),
  parkingAccess: z.enum(["easy", "street", "limited"]).default("easy"),
  frequency: z.enum(["one_off", "weekly", "fortnightly", "monthly"]).default("one_off"),
  hasBalcony: z.boolean().default(false),
  exteriorAccess: z.boolean().default(false),
  addOns: z
    .object({
      oven: z.boolean().default(false),
      fridge: z.boolean().default(false),
      heavyMess: z.boolean().default(false),
      sameDay: z.boolean().default(false),
      furnished: z.boolean().default(false),
      pets: z.boolean().default(false),
      outdoorArea: z.boolean().default(false),
    })
    .optional(),
  conditionLevel: z.enum(["light", "standard", "heavy"]).default("standard"),
  promoCode: z.string().trim().min(2).max(40).optional(),
});

export const leadSchema = z.object({
  serviceType: marketedJobTypeSchema,
  name: requiredNameSchema,
  email: requiredEmailSchema,
  phone: optionalAustralianPhoneSchema,
  address: optionalAddressSchema,
  suburb: optionalSuburbSchema,
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  hasBalcony: z.boolean().default(false),
  notes: z.string().trim().max(12000).optional(),
  estimateMin: z.number().optional(),
  estimateMax: z.number().optional(),
  requestedServiceLabel: z.string().trim().max(120).optional(),
  promoCode: z.string().trim().max(40).optional(),
  structuredContext: z.record(z.any()).optional(),
});

export const createQuoteSchema = z.object({
  leadId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  serviceType: z.nativeEnum(JobType),
  lineItems: z.array(
    z.object({
      label: z.string(),
      unitPrice: z.number(),
      qty: z.number(),
      total: z.number(),
    })
  ),
  subtotal: z.number(),
  gstAmount: z.number(),
  totalAmount: z.number(),
  notes: z.string().optional(),
  validUntil: z.string().datetime().optional(),
});
