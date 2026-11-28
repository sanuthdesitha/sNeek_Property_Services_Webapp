/**
 * The whole-property walkthrough videos of a job form (cleaner job flow v2,
 * 2026-11-28): ONE arrival video and ONE exit video per job, never one per
 * room. A phone that splits a long recording uploads several files to the
 * same question; that is still the one video.
 *
 * A question is the arrival (or exit) video when it says so explicitly
 * (`walkthroughVideo: "arrival" | "exit"`) or carries one of the standard
 * field ids below. Labels are never read: a renamed question keeps its role,
 * and a question that merely mentions "video" gains none.
 *
 * Plain module (no server imports): the cleaner screen, the form route and
 * tests share it.
 */
import type { FormField, FormSchema, FormSection } from "./types";

export type WalkthroughKind = "arrival" | "exit";

/** Standard ids: the injected Arrival evidence section and the v4 form. */
export const ARRIVAL_VIDEO_FIELD_IDS: readonly string[] = ["arrival-evidence.walkthrough-video", "arrival-walkthrough-video"];
export const EXIT_VIDEO_FIELD_IDS: readonly string[] = ["exit-walkthrough-video"];

export type WalkthroughVideoField = {
  fieldId: string;
  sectionId: string;
};

export type WalkthroughVideoFields = {
  arrival: WalkthroughVideoField | null;
  exit: WalkthroughVideoField | null;
};

type FieldLike = Pick<FormField, "id" | "type"> & { walkthroughVideo?: unknown; children?: FieldLike[] };

function isVideoCapable(field: FieldLike): boolean {
  // "upload" is the legacy alias some stored templates still carry.
  const type: string = String(field.type);
  return type === "video" || type === "photo" || type === "upload" || type === "file";
}

export function walkthroughKindOf(field: FieldLike | null | undefined): WalkthroughKind | null {
  if (!field || !isVideoCapable(field)) return null;
  if (field.walkthroughVideo === "arrival" || field.walkthroughVideo === "exit") return field.walkthroughVideo;
  const id = String(field.id ?? "");
  if (ARRIVAL_VIDEO_FIELD_IDS.includes(id)) return "arrival";
  if (EXIT_VIDEO_FIELD_IDS.includes(id)) return "exit";
  return null;
}

/** The first arrival and the first exit video question of the form, with their sections. */
export function findWalkthroughVideoFields(schema: Pick<FormSchema, "sections"> | null | undefined): WalkthroughVideoFields {
  const found: WalkthroughVideoFields = { arrival: null, exit: null };
  const sections: FormSection[] = Array.isArray(schema?.sections) ? schema!.sections : [];
  for (const section of sections) {
    const fields: FieldLike[] = Array.isArray(section?.fields) ? (section.fields as FieldLike[]) : [];
    const stack: FieldLike[] = [...fields];
    while (stack.length > 0) {
      const field = stack.shift()!;
      const kind = walkthroughKindOf(field);
      if (kind && found[kind] === null) found[kind] = { fieldId: String(field.id), sectionId: String(section.id) };
      if (Array.isArray(field.children)) stack.push(...field.children);
    }
  }
  return found;
}

export type ArrivalVideoLock =
  | { locked: false }
  | { locked: true; fieldId: string; sectionId: string };

/**
 * The rest of the checklist stays locked until the arrival video has at least
 * one uploaded file. Forms without an arrival video question are never locked.
 */
export function arrivalVideoLock(
  schema: Pick<FormSchema, "sections"> | null | undefined,
  uploadCounts: Record<string, number>,
  /** Questions the office allowed this job to be submitted without: an allowed arrival video unlocks. */
  officeAllowedFieldIds: readonly string[] = [],
): ArrivalVideoLock {
  const { arrival } = findWalkthroughVideoFields(schema);
  if (!arrival) return { locked: false };
  if (officeAllowedFieldIds.includes(arrival.fieldId)) return { locked: false };
  if ((uploadCounts[arrival.fieldId] ?? 0) > 0) return { locked: false };
  return { locked: true, fieldId: arrival.fieldId, sectionId: arrival.sectionId };
}
