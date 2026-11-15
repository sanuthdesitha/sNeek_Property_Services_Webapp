/**
 * Query parsing for the New job preview routes (plain module, tested).
 * Dates are calendar days (yyyy-MM-dd) and never shifted; at most 31 per
 * request, de-duplicated and sorted.
 */
import { JobType } from "@prisma/client";
import { z } from "zod";

const time = z.string().regex(/^\d{2}:\d{2}$/, "Times are HH:mm.");
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are yyyy-MM-dd.").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "That date does not exist.");

export const MAX_PREVIEW_DAYS = 31;

export const propertyQuerySchema = z.object({
  propertyId: z.string().trim().min(1, "Choose a property."),
  jobType: z.nativeEnum(JobType),
});

export const dayQuerySchema = z.object({
  propertyId: z.string().trim().min(1, "Choose a property."),
  jobType: z.nativeEnum(JobType),
  dates: z
    .string()
    .transform((value) => Array.from(new Set(value.split(",").map((part) => part.trim()).filter(Boolean))).sort())
    .pipe(z.array(dayKey).min(1, "Choose a date.").max(MAX_PREVIEW_DAYS, `At most ${MAX_PREVIEW_DAYS} dates at once.`)),
  startTime: time.optional(),
  dueTime: time.optional(),
  endTime: time.optional(),
  estimatedHours: z.coerce.number().positive().max(24).optional(),
  suggest: z.enum(["0", "1"]).optional(),
});

export type DayQuery = z.infer<typeof dayQuerySchema>;

/** Reads only the known parameters; an empty value counts as absent. */
export function readQuery(searchParams: URLSearchParams, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value !== null && value.trim() !== "") out[key] = value.trim();
  }
  return out;
}
