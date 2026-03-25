import { z } from "zod";

export const AU_STATE_CODES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function blankToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized : undefined;
}

function stripPhoneFormatting(value: string) {
  return value.replace(/[\s()-]/g, "");
}

function stripDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeAustralianPhoneForValidation(value: string) {
  const compact = stripPhoneFormatting(normalizeWhitespace(value));
  if (compact.startsWith("+61")) return `0${compact.slice(3)}`;
  if (compact.startsWith("61")) return `0${compact.slice(2)}`;
  return compact;
}

export function isValidAustralianMobile(value: string) {
  return /^04\d{8}$/.test(normalizeAustralianPhoneForValidation(value));
}

export function isValidAustralianPhone(value: string) {
  const local = normalizeAustralianPhoneForValidation(value);
  return /^(04\d{8}|0[2378]\d{8}|1300\d{6}|1800\d{6})$/.test(local);
}

export function isValidInternationalPhone(value: string) {
  const compact = stripPhoneFormatting(normalizeWhitespace(value)).replace(/^\+/, "");
  return /^\d{8,15}$/.test(compact);
}

export function isValidAustralianPostcode(value: string) {
  return /^\d{4}$/.test(stripDigits(value));
}

export function isValidAustralianBsb(value: string) {
  return stripDigits(value).length === 6;
}

export function isValidAustralianAccountNumber(value: string) {
  const digits = stripDigits(value);
  return digits.length >= 6 && digits.length <= 10;
}

export function isValidAbn(value: string) {
  const digits = stripDigits(value);
  if (digits.length !== 11) return false;
  const numbers = digits.split("").map(Number);
  numbers[0] -= 1;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const checksum = numbers.reduce((sum, digit, index) => sum + digit * weights[index], 0);
  return checksum % 89 === 0;
}

function looksLikeText(value: string) {
  return /[A-Za-z0-9]/.test(value);
}

export const requiredNameSchema = z.string().trim().min(1, "Name is required").max(200, "Name is too long.");
export const requiredEmailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(200, "Email is too long.");
export const optionalEmailSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().email("Enter a valid email address.").max(200, "Email is too long.").optional()
);
export const optionalAustralianMobileSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidAustralianMobile, {
      message: "Use a valid Australian mobile number, for example 0451217210 or +61451217210.",
    })
    .optional()
);
export const optionalAustralianPhoneSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidAustralianPhone, {
      message: "Use a valid Australian phone number, for example 0451217210 or +61451217210.",
    })
    .optional()
);
export const optionalInternationalPhoneSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidInternationalPhone, {
      message: "Use a valid phone number with 8 to 15 digits.",
    })
    .optional()
);
export const requiredAddressSchema = z
  .string()
  .trim()
  .min(5, "Address is required.")
  .max(500, "Address is too long.")
  .refine(looksLikeText, { message: "Enter a valid address." });
export const optionalAddressSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .max(500, "Address is too long.")
    .refine(looksLikeText, { message: "Enter a valid address." })
    .optional()
);
export const requiredSuburbSchema = z
  .string()
  .trim()
  .min(2, "Suburb is required.")
  .max(120, "Suburb is too long.")
  .refine(looksLikeText, { message: "Enter a valid suburb." });
export const optionalSuburbSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .max(120, "Suburb is too long.")
    .refine(looksLikeText, { message: "Enter a valid suburb." })
    .optional()
);
export const requiredAustralianStateSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => AU_STATE_CODES.includes(value as (typeof AU_STATE_CODES)[number]), {
    message: "State must be one of NSW, VIC, QLD, WA, SA, TAS, ACT, NT.",
  });
export const optionalAustralianStateSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => AU_STATE_CODES.includes(value as (typeof AU_STATE_CODES)[number]), {
      message: "State must be one of NSW, VIC, QLD, WA, SA, TAS, ACT, NT.",
    })
    .optional()
);
export const optionalPostcodeSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidAustralianPostcode, { message: "Postcode must be exactly 4 digits." })
    .optional()
);
export const optionalAbnSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidAbn, { message: "ABN must be a valid 11 digit Australian Business Number." })
    .optional()
);
export const optionalBsbSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidAustralianBsb, { message: "BSB must be exactly 6 digits." })
    .optional()
);
export const optionalAccountNumberSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidAustralianAccountNumber, {
      message: "Account number must be 6 to 10 digits.",
    })
    .optional()
);
export const optionalBusinessNameSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().max(200, "Business name is too long.").optional()
);
export const optionalNoteSchema = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, `Maximum ${max} characters.`).optional());
