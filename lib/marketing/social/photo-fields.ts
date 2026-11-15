/**
 * Which cleaner form photos the social post generator may ever offer
 * (2026-11-17). Plain module.
 *
 * Only listing-angle and final-look fields, a few finished-room fields and
 * the arrival "before" photos (which also need the owner's before-photo
 * permission and a person's tick on each photo). Everything else is
 * evidence, not marketing, and is never offered: close-ups, lockbox and
 * keys, doors, arrival mess and signs, stains, bins, under the bed and under
 * the cushions, videos.
 */

export type PhotoFieldKind = "LISTING" | "FINAL" | "BEFORE";

export type SocialPhotoField = {
  fieldId: string;
  kind: PhotoFieldKind;
  /** The room in words (captions, alt text suggestions, variety). */
  room: string;
  /** The form question, as the cleaner saw it. */
  label: string;
  /** Starting alt text; the person edits it. */
  altHint: string;
};

export const SOCIAL_PHOTO_FIELDS: readonly SocialPhotoField[] = [
  { fieldId: "staging-living", kind: "LISTING", room: "Living", label: "Final look — living area from the listing angle", altHint: "Living room set up for guests" },
  { fieldId: "staging-kitchen", kind: "LISTING", room: "Kitchen", label: "Final look — kitchen from the listing angle", altHint: "Clean kitchen with clear benches" },
  { fieldId: "staging-welcome", kind: "LISTING", room: "Welcome items", label: "Welcome items placed", altHint: "Welcome items set out for the next guests" },
  { fieldId: "bed-final-look", kind: "LISTING", room: "Bedroom", label: "Final look from the doorway", altHint: "Bedroom made up with fresh linen, seen from the doorway" },
  { fieldId: "bed-made", kind: "FINAL", room: "Bedroom", label: "Bed made with fresh linen", altHint: "Bed made with fresh white linen" },
  { fieldId: "bath-towels-amenities", kind: "FINAL", room: "Bathroom", label: "Towels, toilet paper and amenities set out", altHint: "Bathroom with fresh towels and amenities set out" },
  { fieldId: "bath-vanity", kind: "FINAL", room: "Bathroom vanity", label: "Basin, vanity and mirror", altHint: "Clean basin and vanity" },
  { fieldId: "kitchen-benches-sink", kind: "FINAL", room: "Kitchen benches", label: "Benches, sink and cooktop", altHint: "Wiped benches, sink and cooktop" },
  { fieldId: "balcony-area", kind: "FINAL", room: "Balcony", label: "Balcony floor, furniture and glass", altHint: "Swept balcony with outdoor furniture" },
  { fieldId: "arrival-before-photos", kind: "BEFORE", room: "Before", label: "Before photos — worst spots", altHint: "The room before cleaning" },
];

export function socialPhotoField(fieldId: string): SocialPhotoField | null {
  return SOCIAL_PHOTO_FIELDS.find((field) => field.fieldId === fieldId) ?? null;
}

export const SOCIAL_FIELD_IDS: readonly string[] = SOCIAL_PHOTO_FIELDS.map((field) => field.fieldId);

/** Said on the candidates screen, so a missing photo is never a mystery. */
export const NEVER_OFFERED_TEXT =
  "Close-ups (grout, rangehood filter, bins), lockbox, key, door and arrival mess photos are never offered: they are evidence, not marketing.";
