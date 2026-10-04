import type { FormSchema, FormSection } from "./types";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";

export const LAUNDRY_AREA_SECTION = "laundry-area-evidence-v1";
export const LAUNDRY_AREA_STATUS = "laundry-area-evidence-status";
export const LAUNDRY_AREA_PHOTO = "laundry-area-appliance-photo";
export const LAUNDRY_AREA_REASON = "laundry-area-photo-not-taken-reason";
export const LAUNDRY_AREA_OPTIONS = ["Photo supplied", "Photo not taken", "Not applicable — no laundry area or appliances"];
const residentialTypes = new Set(["AIRBNB_TURNOVER", "GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "MOVE_IN_CLEAN"]);

/** Creation-only version marker. Existing jobs and their evidence revisions stay intact. */
export function markNewJobLaundryArea<T extends Record<string, any>>(data: T): T {
  if (!residentialTypes.has(data.jobType) || data.isRework === true) return data;
  // Preserve unknown version-1 metadata too; this stamps a version, not a rewrite.
  let raw;
  try { raw = JSON.parse(data.internalNotes ?? "null"); } catch { raw = null; }
  const notes = raw?.version === 1
    ? JSON.stringify({ ...raw, laundryAreaEvidenceVersion: 1 })
    : serializeJobInternalNotes({ ...parseJobInternalNotes(data.internalNotes), laundryAreaEvidenceVersion: 1 });
  return { ...data, internalNotes: notes };
}

export function withLaundryAreaEvidence(schema: FormSchema, job: { jobType: string; isRework: boolean; internalNotes?: string | null }): FormSchema {
  if (job.isRework || !residentialTypes.has(job.jobType) || parseJobInternalNotes(job.internalNotes).laundryAreaEvidenceVersion !== 1) return schema;
  // Never replace a property template's own fields or silently duplicate stable IDs.
  const ids = new Set<string>();
  for (const section of schema.sections) {
    ids.add(section.id);
    for (const field of section.fields) {
      ids.add(field.id);
      for (const child of field.children ?? []) ids.add(child.id);
    }
  }
  if ([LAUNDRY_AREA_SECTION, LAUNDRY_AREA_STATUS, LAUNDRY_AREA_PHOTO, LAUNDRY_AREA_REASON].some(id => ids.has(id))) return schema;
  const section: FormSection = {
    id: LAUNDRY_AREA_SECTION, title: "Laundry area & appliances",
    description: "Record the laundry area and washing machine/dryer condition after cleaning. The bag/pickup photo belongs in the separate linen update.",
    fields: [
      { id: LAUNDRY_AREA_STATUS, type: "select", label: "Laundry-area evidence", required: true, options: [...LAUNDRY_AREA_OPTIONS] },
      { id: LAUNDRY_AREA_PHOTO, type: "photo", label: "Laundry area / washing machine / dryer photos", required: true, minPhotos: 1,
        locationTag: "Laundry area", conditional: { fieldId: LAUNDRY_AREA_STATUS, operator: "equals", value: LAUNDRY_AREA_OPTIONS[0] } },
      { id: LAUNDRY_AREA_REASON, type: "longtext", label: "Why was the laundry-area photo not taken?", required: true,
        helpText: "Record what actually happened. This records missing evidence; it does not claim a photo was supplied.",
        conditional: { fieldId: LAUNDRY_AREA_STATUS, operator: "equals", value: LAUNDRY_AREA_OPTIONS[1] } },
    ],
  };
  return { ...schema, sections: [...schema.sections, section] };
}
