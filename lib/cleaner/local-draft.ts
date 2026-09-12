import { z } from "zod";

const identitySchema = z.string().regex(/^[a-f0-9]{64}$/);
const envelopeSchema = z.object({
  version: z.literal(1),
  identity: identitySchema,
  state: z.record(z.unknown()),
}).strict();

export const cleanerLocalDraftKey = (identity: string) => `cleaner-job-draft-v3:${identity}`;
export type LocalDraftRead =
  | { status: "ready"; state: Record<string, unknown> }
  | { status: "empty" | "invalid" | "unavailable" };

export function readCleanerLocalDraft(identity: string): LocalDraftRead {
  if (!identitySchema.safeParse(identity).success) return { status: "invalid" };
  try {
    const raw = window.localStorage.getItem(cleanerLocalDraftKey(identity));
    if (raw === null) return { status: "empty" };
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { status: "invalid" }; }
    const envelope = envelopeSchema.safeParse(parsed);
    if (!envelope.success || envelope.data.identity !== identity) return { status: "invalid" };
    return { status: "ready", state: envelope.data.state };
  } catch { return { status: "unavailable" }; }
}

export function writeCleanerLocalDraft(identity: string, state: Record<string, unknown>): boolean {
  const envelope = envelopeSchema.safeParse({ version: 1, identity, state });
  if (!envelope.success) return false;
  // Preserve unreadable recovery data rather than replacing it blindly.
  const existing = readCleanerLocalDraft(identity);
  if (existing.status === "invalid" || existing.status === "unavailable") return false;
  try {
    window.localStorage.setItem(cleanerLocalDraftKey(identity), JSON.stringify(envelope.data));
    return true;
  } catch { return false; }
}

export function clearCleanerLocalDraft(identity: string): boolean {
  if (!identitySchema.safeParse(identity).success) return false;
  const existing = readCleanerLocalDraft(identity);
  if (existing.status === "invalid" || existing.status === "unavailable") return false;
  try { window.localStorage.removeItem(cleanerLocalDraftKey(identity)); return true; }
  catch { return false; }
}

export function hasLegacyCleanerLocalDraft(jobId: string): boolean {
  try { return window.localStorage.getItem(`cleaner-job-draft-v2:${jobId}`) !== null; }
  catch { return false; }
}
