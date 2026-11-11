/**
 * Request and response contract of POST /api/admin/form-templates/bulk.
 * Client-safe (zod only), so the screen builds requests from the same schema
 * the route validates.
 */
import { z } from "zod";
import type { FieldChange } from "./template-bulk-edits";

/** At most this many forms per bulk request. */
export const BULK_MAX_FORMS = 50;

const matchZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fieldId"), fieldId: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal("wording"),
    section: z.string().max(200),
    label: z.string().min(1).max(300),
    type: z.string().min(1).max(40),
  }),
]);

export const questionEditZ = z.discriminatedUnion("property", [
  z.object({ property: z.literal("label"), value: z.string().trim().min(1, "A question needs a label.").max(300) }),
  z.object({ property: z.literal("helpText"), value: z.string().max(500) }),
  z.object({ property: z.literal("required"), value: z.boolean() }),
  z.object({ property: z.literal("minPhotos"), value: z.number().int().min(0).max(20) }),
  z.object({ property: z.literal("maxFiles"), value: z.number().int().min(1).max(50) }),
  z.object({ property: z.literal("severity"), value: z.enum(["low", "medium", "high"]).nullable() }),
  z.object({ property: z.literal("detailsWhenNo"), value: z.boolean() }),
]);

const tagZ = z.string().trim().min(1).max(30);

export const bulkOperationZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("edit-question"), match: matchZ, edit: questionEditZ }),
  z.object({
    type: z.literal("add-section"),
    section: z.object({
      title: z.string().trim().min(1, "Give the section a title.").max(120),
      description: z.string().max(500).optional(),
      questions: z.array(z.string().max(300)).max(50),
      position: z.enum(["start", "end"]),
    }),
  }),
  z.object({
    type: z.literal("find-replace"),
    find: z.string().min(1, "Enter the wording to find.").max(200),
    replace: z.string().max(200),
    matchCase: z.boolean().default(false),
  }),
  z.object({ type: z.literal("move-to-group"), groupId: z.string().min(1).nullable() }),
  z.object({ type: z.literal("set-tags"), add: z.array(tagZ).max(20), remove: z.array(tagZ).max(20) }),
  z.object({ type: z.literal("publish") }),
  z.object({ type: z.literal("duplicate") }),
  z.object({ type: z.literal("archive") }),
]);

export const bulkRequestZ = z.object({
  templateIds: z
    .array(z.string().min(1))
    .min(1, "Choose at least one form.")
    .max(BULK_MAX_FORMS, `Choose at most ${BULK_MAX_FORMS} forms at a time.`),
  dryRun: z.boolean().default(false),
  note: z.string().max(200).optional(),
  operation: bulkOperationZ,
});

export type BulkOperation = z.infer<typeof bulkOperationZ>;
export type BulkOperationType = BulkOperation["type"];
export type BulkRequest = z.input<typeof bulkRequestZ>;

/**
 * changed:      applied (content edits: saved as a draft, not live)
 * would-change: dry run — what applying would do
 * unchanged:    nothing to do for this form (reason says why)
 * refused:      not done because a rule stopped it (reason says which)
 */
export type BulkOutcomeStatus = "changed" | "would-change" | "unchanged" | "refused";

export type BulkFormOutcome = {
  templateId: string;
  name: string;
  status: BulkOutcomeStatus;
  reason?: string;
  changes: FieldChange[];
  /** Content edits: a draft version was written (nothing reached cleaners). */
  draftSaved?: boolean;
  /** Duplicate: the new draft's id. */
  newTemplateId?: string;
  /** Publish: the new live version, or null when published as it was. */
  publishedVersion?: number | null;
  /** Publish: other live forms archived so jobs resolve to this one. */
  archivedPrevious?: number;
};

export type BulkResponse = {
  dryRun: boolean;
  operation: BulkOperationType;
  outcomes: BulkFormOutcome[];
  summary: { changed: number; unchanged: number; refused: number };
};
