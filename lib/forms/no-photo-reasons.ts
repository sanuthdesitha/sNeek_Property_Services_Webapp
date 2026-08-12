// Coded reasons a cleaner can give for not photographing an upload field.
//
// The "no photo taken" option exists for unavoidable circumstances only and is
// available solely to cleaners an admin has exempted in settings
// (noPhotoExemptCleanerIds). Coded — not free text — so missed-photo patterns
// can be counted and compared per cleaner and per reason.
//
// Submission shape (inside FormSubmission.data):
//   __noPhotoReasons: { [fieldId]: { reasonCode: NoPhotoReasonCode, note?: string } }

export const NO_PHOTO_REASONS = {
  AREA_INACCESSIBLE: "Area locked or inaccessible",
  GUEST_PRESENT: "Guest or occupant present — privacy",
  DEVICE_FAILURE: "Phone/camera failure",
  NO_SIGNAL_UPLOAD_FAILED: "No signal — upload kept failing",
  SAFETY_CONCERN: "Unsafe to photograph",
  OTHER: "Other (explain in the note)",
} as const;

export type NoPhotoReasonCode = keyof typeof NO_PHOTO_REASONS;

export type NoPhotoReasonEntry = {
  reasonCode: NoPhotoReasonCode;
  note?: string;
};

export function isValidNoPhotoReasonCode(code: unknown): code is NoPhotoReasonCode {
  return typeof code === "string" && code in NO_PHOTO_REASONS;
}

export function noPhotoReasonLabel(code: unknown): string {
  return isValidNoPhotoReasonCode(code) ? NO_PHOTO_REASONS[code] : "Reason not recorded";
}

/**
 * Normalize the raw `__noPhotoReasons` value from a submission's data JSON:
 * keeps only entries with a valid reason code, trims notes, requires a note
 * for OTHER. Returns an empty object for anything malformed.
 */
export function sanitizeNoPhotoReasons(
  raw: unknown
): Record<string, NoPhotoReasonEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, NoPhotoReasonEntry> = {};
  for (const [fieldId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!fieldId.trim() || !value || typeof value !== "object") continue;
    const reasonCode = (value as { reasonCode?: unknown }).reasonCode;
    if (!isValidNoPhotoReasonCode(reasonCode)) continue;
    const rawNote = (value as { note?: unknown }).note;
    const note = typeof rawNote === "string" ? rawNote.trim().slice(0, 1000) : "";
    if (reasonCode === "OTHER" && !note) continue;
    out[fieldId] = { reasonCode, ...(note ? { note } : {}) };
  }
  return out;
}
