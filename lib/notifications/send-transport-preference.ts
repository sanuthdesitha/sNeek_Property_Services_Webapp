import "server-only";
/**
 * "Don't ask again" for the office's transport choice (owner decision
 * 2026-11-12, item B). A per-user preference of the person SENDING, stored as
 * one AppSetting JSON row keyed by their user id (the same pattern as the Jobs
 * saved views, `admin_jobs_views_v1:<userId>`; no schema change).
 *
 * - It only remembers which transports this office user picked for a kind of
 *   send; it never widens what the server allows, and it never changes what a
 *   recipient receives beyond the transports shown in the dialog.
 * - A row that cannot be read is reported as unreadable (`readable: false`), so
 *   the dialog asks again instead of silently sending by a guessed transport.
 * - Reset: "Ask me again" in the dialog (Change) or in Notifications →
 *   Preferences ("Your sending choices"), which deletes the kind.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { DOCUMENT_REQUEST_TRANSPORTS, type DocumentRequestTransport } from "@/lib/workforce/document-request-send";

export const SEND_TRANSPORT_PREFERENCE_PREFIX = "office_send_transports_v1:";

/** The kinds of send that offer "Don't ask again". */
export const SEND_TRANSPORT_KINDS = ["document_request"] as const;
export type SendTransportKind = (typeof SEND_TRANSPORT_KINDS)[number];

export const SEND_TRANSPORT_KIND_LABEL: Record<SendTransportKind, string> = {
  document_request: "Request document and expiring-document reminders",
};

const savedChoiceSchema = z.object({
  transports: z.array(z.enum(DOCUMENT_REQUEST_TRANSPORTS)).min(1).max(3),
  savedAt: z.string().min(1).max(40),
}).strict();

const storedSchema = z.object({
  version: z.literal(1),
  kinds: z.record(z.enum(SEND_TRANSPORT_KINDS), savedChoiceSchema),
}).strict();

export type SavedTransportChoice = z.infer<typeof savedChoiceSchema>;
type StoredPreferences = z.infer<typeof storedSchema>;

export type SendTransportPreferences = {
  /** False when a stored row exists but could not be read; nothing is used then. */
  readable: boolean;
  kinds: Partial<Record<SendTransportKind, SavedTransportChoice>>;
};

export function sendTransportPreferenceKey(userId: string): string {
  return `${SEND_TRANSPORT_PREFERENCE_PREFIX}${userId}`;
}

function decode(value: unknown): StoredPreferences | null {
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function readSendTransportPreferences(userId: string): Promise<SendTransportPreferences> {
  const row = await db.appSetting.findUnique({ where: { key: sendTransportPreferenceKey(userId) } });
  if (!row) return { readable: true, kinds: {} };
  const stored = decode(row.value);
  return stored ? { readable: true, kinds: stored.kinds } : { readable: false, kinds: {} };
}

/** The saved choice for one kind, or null (none saved, or the row is unreadable). */
export async function savedTransportChoice(userId: string, kind: SendTransportKind): Promise<SavedTransportChoice | null> {
  const preferences = await readSendTransportPreferences(userId);
  return preferences.kinds[kind] ?? null;
}

async function writeKinds(userId: string, change: (kinds: StoredPreferences["kinds"]) => StoredPreferences["kinds"]): Promise<SendTransportPreferences> {
  const key = sendTransportPreferenceKey(userId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    // An unreadable row is replaced rather than merged: it was not usable anyway.
    const current = (row ? decode(row.value) : null)?.kinds ?? {};
    const next: StoredPreferences = { version: 1, kinds: change({ ...current }) };
    const value = storedSchema.parse(next) as unknown as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return { readable: true, kinds: next.kinds };
  });
}

export async function saveTransportChoice(
  userId: string,
  kind: SendTransportKind,
  transports: readonly DocumentRequestTransport[],
  now = new Date(),
): Promise<SavedTransportChoice> {
  const choice: SavedTransportChoice = { transports: Array.from(new Set(transports)), savedAt: now.toISOString() };
  await writeKinds(userId, (kinds) => ({ ...kinds, [kind]: choice }));
  return choice;
}

export async function clearTransportChoice(userId: string, kind: SendTransportKind): Promise<SendTransportPreferences> {
  return writeKinds(userId, (kinds) => {
    const next = { ...kinds };
    delete next[kind];
    return next;
  });
}
