/**
 * What a cleaner is allowed to send when reporting damage.
 *
 * Two rules this file exists to enforce, both of which are easy to lose in a
 * route handler:
 *
 *  1. `estimatedCost` is ABSENT from every schema here. Cost is an admin/QA
 *     decision made on the investigation page (D2), and the column is
 *     admin-write-only. Because the routes build their Prisma payload from the
 *     PARSED object rather than the raw body, a cleaner sending estimatedCost
 *     has it stripped rather than merely ignored — no `...body` spread can leak
 *     it back in.
 *  2. Draft and submit share one item schema but differ in strictness. A draft
 *     is a phone autosaving mid-documentation: half-typed, possibly empty, and
 *     it must still save or the evidence is lost when the battery dies. A
 *     submit is a claim about a property and has to be complete.
 */

import { z } from "zod";
import { DamageSeverity, DamageSuspectedCause, DamagePhotoSection } from "@prisma/client";

/** Long enough for a real account of the damage, bounded so one item cannot carry a novel. */
const MAX_DESCRIPTION = 4_000;
const MAX_ITEMS_PER_REPORT = 40;
const MAX_PHOTOS_PER_ITEM = 12;

export const damagePhotoSchema = z.object({
  /** Client-generated id so autosave can match photos to existing rows. */
  clientId: z.string().trim().max(64).optional(),
  s3Key: z.string().trim().min(1).max(500),
  annotatedKey: z.string().trim().max(500).nullish(),
  flatKey: z.string().trim().max(500).nullish(),
  caption: z.string().trim().max(300).nullish(),
  section: z.nativeEnum(DamagePhotoSection).default(DamagePhotoSection.OVERVIEW),
});

/**
 * The draft shape: everything optional except the photo keys already uploaded.
 * A cleaner who has taken three photos and typed nothing yet must not lose them.
 */
export const damageItemDraftSchema = z.object({
  clientId: z.string().trim().max(64).optional(),
  area: z.string().trim().max(200).default(""),
  category: z.string().trim().max(200).default(""),
  severity: z.nativeEnum(DamageSeverity).default(DamageSeverity.MODERATE),
  description: z.string().trim().max(MAX_DESCRIPTION).default(""),
  suspectedCause: z.nativeEnum(DamageSuspectedCause).default(DamageSuspectedCause.UNKNOWN),
  photos: z.array(damagePhotoSchema).max(MAX_PHOTOS_PER_ITEM).default([]),
});

export const saveDamageDraftSchema = z.object({
  items: z.array(damageItemDraftSchema).max(MAX_ITEMS_PER_REPORT).default([]),
});

/**
 * The submit shape. Area, category and description become required, and at
 * least one photo per item — a damage claim with no evidence is not one.
 */
export const damageItemSubmitSchema = damageItemDraftSchema.extend({
  area: z.string().trim().min(1, "Say which room or area the damage is in").max(200),
  category: z.string().trim().min(1, "Choose what was damaged").max(200),
  description: z
    .string()
    .trim()
    .min(10, "Describe the damage — at least a sentence")
    .max(MAX_DESCRIPTION),
  photos: z
    .array(damagePhotoSchema)
    .min(1, "Add at least one photo of this damage")
    .max(MAX_PHOTOS_PER_ITEM),
});

export const submitDamageReportSchema = z.object({
  items: z
    .array(damageItemSubmitSchema)
    .min(1, "Add at least one damaged item before submitting")
    .max(MAX_ITEMS_PER_REPORT),
});

export type DamagePhotoInput = z.infer<typeof damagePhotoSchema>;
export type DamageItemDraftInput = z.infer<typeof damageItemDraftSchema>;
export type DamageItemSubmitInput = z.infer<typeof damageItemSubmitSchema>;
export type SaveDamageDraftInput = z.infer<typeof saveDamageDraftSchema>;
export type SubmitDamageReportInput = z.infer<typeof submitDamageReportSchema>;

/**
 * A draft item with nothing in it at all. Autosave sends the card the moment it
 * is added, so blank cards are normal; they are dropped at submit rather than
 * failing validation and blocking the whole report on an empty extra card.
 */
export function isEmptyDamageItem(item: DamageItemDraftInput): boolean {
  return (
    !item.area.trim() &&
    !item.category.trim() &&
    !item.description.trim() &&
    item.photos.length === 0
  );
}
