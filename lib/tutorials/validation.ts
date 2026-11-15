/**
 * Request shapes for the tutorial routes (plain module). Unknown tours,
 * statuses and step ids are refused rather than stored.
 */
import { z } from "zod";
import { TOUR_PROGRESS_STATUSES, TOUR_ROLES, type TourProgressStatus, type TourRole } from "./types";
import { isTourTargetId } from "./targets";
import { countWords } from "./engine";

const stepId = z.string().min(1).max(60).regex(/^[A-Za-z0-9_.-]+$/);

export const progressInputSchema = z.object({
  tourKey: z.string().min(1).max(80),
  version: z.number().int().min(1).max(1_000_000),
  status: z.enum(TOUR_PROGRESS_STATUSES as [TourProgressStatus, ...TourProgressStatus[]]),
  seenSteps: z.array(stepId).max(60).default([]),
  missingSteps: z.array(stepId).max(60).default([]),
  currentStep: z.number().int().min(0).max(60).default(0),
});
export type ProgressInput = z.infer<typeof progressInputSchema>;

export const preferenceInputSchema = z
  .object({
    toursOn: z.boolean().optional(),
    dontShowAgain: z.object({ tourKey: z.string().min(1).max(80), value: z.boolean() }).optional(),
  })
  .refine((value) => value.toursOn !== undefined || value.dontShowAgain !== undefined, "Nothing to change.");
export type PreferenceInput = z.infer<typeof preferenceInputSchema>;

const stepOverrideSchema = z.object({
  id: stepId,
  title: z.string().trim().max(60).optional(),
  body: z
    .string()
    .trim()
    .max(240)
    .refine((text) => countWords(text) <= 25, "At most 25 words.")
    .optional(),
  hidden: z.boolean().optional(),
  target: z.string().refine(isTourTargetId, "Choose a target from the registry.").optional(),
  whatsNew: z.boolean().optional(),
});

export const tourSettingInputSchema = z.object({
  status: z.enum(["LIVE", "DRAFT", "PAUSED"]).optional(),
  steps: z.array(stepOverrideSchema).max(30).optional(),
  order: z.array(stepId).max(30).optional(),
});
export type TourSettingInput = z.infer<typeof tourSettingInputSchema>;

export const roleSwitchSchema = z.object({
  role: z.enum(TOUR_ROLES as [TourRole, ...TourRole[]]),
  toursOn: z.boolean(),
});

export const personPatchSchema = z.object({
  toursOn: z.boolean().optional(),
  reset: z.union([z.literal("all"), z.string().min(1).max(80)]).optional(),
});
