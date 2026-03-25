import { z } from "zod";
import { JobType, QuoteStatus } from "@prisma/client";
import {
  optionalAddressSchema,
  optionalAustralianPhoneSchema,
  optionalSuburbSchema,
  requiredEmailSchema,
  requiredNameSchema,
} from "@/lib/validations/common";

export const publicQuoteSchema = z.object({
  serviceType: z.nativeEnum(JobType),
  bedrooms: z.number().int().min(0).max(20),
  bathrooms: z.number().int().min(0).max(20),
  hasBalcony: z.boolean().default(false),
  addOns: z
    .object({
      oven: z.boolean().default(false),
      fridge: z.boolean().default(false),
      heavyMess: z.boolean().default(false),
      sameDay: z.boolean().default(false),
    })
    .optional(),
  conditionLevel: z.enum(["light", "standard", "heavy"]).default("standard"),
});

export const leadSchema = z.object({
  serviceType: z.nativeEnum(JobType),
  name: requiredNameSchema,
  email: requiredEmailSchema,
  phone: optionalAustralianPhoneSchema,
  address: optionalAddressSchema,
  suburb: optionalSuburbSchema,
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  hasBalcony: z.boolean().default(false),
  notes: z.string().trim().max(4000).optional(),
  estimateMin: z.number().optional(),
  estimateMax: z.number().optional(),
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
