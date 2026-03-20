import { z } from "zod";

const adminCreateRoleSchema = z.enum(["CLEANER", "CLIENT", "LAUNDRY"]);
const registerRoleSchema = z.enum(["CLEANER", "CLIENT"]);

const bankDetailsSchema = z
  .object({
    accountName: z.string().trim().max(160).optional(),
    bankName: z.string().trim().max(160).optional(),
    bsb: z.string().trim().max(16).optional(),
    accountNumber: z.string().trim().max(32).optional(),
  })
  .optional();

export const createUserByAdminSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Valid email is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: adminCreateRoleSchema,
    phone: z.string().trim().optional(),
    clientId: z.string().trim().optional(),
    clientName: z.string().trim().optional(),
    clientAddress: z.string().trim().optional(),
    clientNotes: z.string().trim().optional(),
    businessName: z.string().trim().max(200).optional(),
    abn: z.string().trim().max(32).optional(),
    address: z.string().trim().max(500).optional(),
    contactNumber: z.string().trim().max(32).optional(),
    bankDetails: bankDetailsSchema,
  });

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: z.string().trim().email("Valid email is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    role: registerRoleSchema,
    phone: z.string().trim().optional(),
    clientName: z.string().trim().optional(),
    clientAddress: z.string().trim().optional(),
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
