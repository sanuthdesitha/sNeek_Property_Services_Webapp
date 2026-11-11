/** Bounds and validation for a default hourly rate. Pure; safe for the browser. */
import { z } from "zod";

export const MIN_HOURLY_RATE = 1;
export const MAX_HOURLY_RATE = 500;

export const payRateSchema = z
  .object({
    hourlyRate: z
      .number({ invalid_type_error: "Enter the hourly rate as a number." })
      .finite()
      .min(MIN_HOURLY_RATE, `The hourly rate must be at least $${MIN_HOURLY_RATE}.`)
      .max(MAX_HOURLY_RATE, `The hourly rate cannot be more than $${MAX_HOURLY_RATE}.`)
      .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use at most two decimal places."),
  })
  .strict();
