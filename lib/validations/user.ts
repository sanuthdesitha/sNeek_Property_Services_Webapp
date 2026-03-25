import { z } from "zod";
import {
  optionalAbnSchema,
  optionalAccountNumberSchema,
  optionalAddressSchema,
  optionalAustralianMobileSchema,
  optionalAustralianPhoneSchema,
  optionalBsbSchema,
  optionalBusinessNameSchema,
  optionalEmailSchema,
  requiredEmailSchema,
  requiredNameSchema,
} from "@/lib/validations/common";

const adminCreateRoleSchema = z.enum(["CLEANER", "CLIENT", "LAUNDRY"]);
const registerRoleSchema = z.enum(["CLEANER", "CLIENT"]);

const bankDetailsSchema = z
  .object({
    accountName: z.string().trim().max(160).optional(),
    bankName: z.string().trim().max(160).optional(),
    bsb: optionalBsbSchema,
    accountNumber: optionalAccountNumberSchema,
  })
  .optional();

export const createUserByAdminSchema = z
  .object({
    name: requiredNameSchema,
    email: requiredEmailSchema,
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: adminCreateRoleSchema,
    phone: optionalAustralianMobileSchema,
    clientId: z.string().trim().optional(),
    clientName: optionalBusinessNameSchema,
    clientAddress: optionalAddressSchema,
    clientNotes: z.string().trim().max(4000).optional(),
    businessName: optionalBusinessNameSchema,
    abn: optionalAbnSchema,
    address: optionalAddressSchema,
    contactNumber: optionalAustralianPhoneSchema,
    bankDetails: bankDetailsSchema,
  });

export const registerSchema = z
  .object({
    name: requiredNameSchema,
    email: requiredEmailSchema,
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: registerRoleSchema,
    phone: optionalAustralianMobileSchema,
    clientName: optionalBusinessNameSchema,
    clientAddress: optionalAddressSchema,
  })
  .superRefine((value, ctx) => {
    if (value.role === "CLIENT" && !value.clientName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Client business/name is required for client registration.",
        path: ["clientName"],
      });
    }
  });

export const updateUserByAdminSchema = z.object({
  name: requiredNameSchema.optional(),
  email: optionalEmailSchema,
  phone: optionalAustralianMobileSchema.nullable().optional(),
  role: z.enum(["ADMIN", "OPS_MANAGER", "CLEANER", "CLIENT", "LAUNDRY"]).optional(),
  isActive: z.boolean().optional(),
  clientId: z.string().trim().nullable().optional(),
  businessName: optionalBusinessNameSchema.nullable().optional(),
  abn: optionalAbnSchema.nullable().optional(),
  address: optionalAddressSchema.nullable().optional(),
  contactNumber: optionalAustralianPhoneSchema.nullable().optional(),
  bankDetails: bankDetailsSchema.nullable().optional(),
});

export const onboardingProfileSchema = z.object({
  name: requiredNameSchema.optional(),
  phone: optionalAustralianMobileSchema,
  businessName: optionalBusinessNameSchema,
  abn: optionalAbnSchema,
  address: optionalAddressSchema,
  contactNumber: optionalAustralianPhoneSchema,
  bankDetails: z
    .object({
      accountName: z.string().trim().max(160).optional(),
      bankName: z.string().trim().max(160).optional(),
      bsb: optionalBsbSchema,
      accountNumber: optionalAccountNumberSchema,
    })
    .optional(),
  tutorialSeen: z.boolean().optional(),
});

export const profileUpdateSchema = z.object({
  name: requiredNameSchema.optional(),
  phone: optionalAustralianMobileSchema,
  email: optionalEmailSchema,
  image: z.string().trim().max(4000).nullable().optional(),
});
