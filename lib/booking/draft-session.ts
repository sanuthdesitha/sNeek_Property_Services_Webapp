import { z } from "zod";

const scopeSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const dateSchema = z.string().max(10).refine((value) => {
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected an empty or real YYYY-MM-DD date");

const bookingFields = {
  propertyId: z.string().max(200),
  jobType: z.string().max(100),
  scheduledDate: dateSchema,
  notes: z.string().max(4000),
};
const payloadSchema = z.object({
  ...bookingFields,
  propertyId: bookingFields.propertyId.min(1),
  jobType: bookingFields.jobType.min(1),
  scheduledDate: dateSchema.refine((value) => value !== ""),
}).strict();

const draftSchema = z.object({
  ...bookingFields,
  step: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  request: z.object({
    key: z.string().uuid(),
    payload: z.string().max(10000),
  }).strict().optional(),
  confirmedRequestId: z.string().min(1).max(200).optional(),
}).strict().superRefine((draft, ctx) => {
  if (draft.confirmedRequestId !== undefined && !draft.request) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Confirmation requires a request" });
  }
  if (!draft.request) return;
  // Preserve the original retry body, but validate every field before storing or returning it.
  try {
    const payload = payloadSchema.safeParse(JSON.parse(draft.request.payload));
    if (payload.success &&
      payload.data.propertyId === draft.propertyId &&
      payload.data.jobType === draft.jobType &&
      payload.data.scheduledDate === draft.scheduledDate &&
      payload.data.notes === draft.notes) return;
  } catch {
    // Malformed JSON is handled as a validation failure below.
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Request payload must match the draft" });
});

export type BookingDraft = z.infer<typeof draftSchema>;

const envelopeSchema = z.object({
  version: z.literal(1),
  scope: scopeSchema,
  draft: draftSchema,
}).strict();

function storageKey(scope: string): string {
  return `sneek:booking-draft:v1:${scope}`;
}

/** Reads only this tab's scoped draft; unavailable storage is distinct from missing data. */
export function loadBookingDraft(scope: string): {
  status: "empty" | "ready" | "unavailable" | "invalid";
  draft?: BookingDraft;
} {
  if (!scopeSchema.safeParse(scope).success) return { status: "invalid" };
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(storageKey(scope));
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "empty" };
  try {
    const envelope = envelopeSchema.safeParse(JSON.parse(raw));
    if (!envelope.success || envelope.data.scope !== scope) return { status: "invalid" };
    return { status: "ready", draft: envelope.data.draft };
  } catch {
    return { status: "invalid" };
  }
}

export function saveBookingDraft(scope: string, draft: BookingDraft): boolean {
  try {
    const envelope = envelopeSchema.safeParse({ version: 1, scope, draft });
    if (!envelope.success) return false;
    window.sessionStorage.setItem(storageKey(scope), JSON.stringify(envelope.data));
    return true;
  } catch {
    return false;
  }
}

export function removeBookingDraft(scope: string): boolean {
  if (!scopeSchema.safeParse(scope).success) return false;
  try {
    window.sessionStorage.removeItem(storageKey(scope));
    return true;
  } catch {
    return false;
  }
}
