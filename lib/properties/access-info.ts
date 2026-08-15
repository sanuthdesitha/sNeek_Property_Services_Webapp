/**
 * Property.accessInfo normalisation, shared by the admin property create
 * (POST /api/admin/properties) and update (PATCH /api/admin/properties/:id)
 * routes, which previously carried identical private copies of this logic.
 *
 * Property.accessInfo is a free-form JSON column holding:
 *   lockbox, parking, other, instructions         (strings, edited by admin)
 *   accessNotesSummary                            (derived, for cleaner briefs)
 *   laundryTeamUserIds: string[]                  (laundry allocation)
 *   attachments: {name,url,key?,contentType?}[]   (access photos/PDFs)
 *   defaultCleanDurationHours, maxGuestCount      (set at onboarding)
 *
 * SECURITY — `codes` is deliberately absent from that list and must not come
 * back. This module used to copy the raw door code from `input.accessCode`
 * into `accessInfo.codes`, so every property stored its entry code twice: once
 * encrypted in Property.accessCode, and once as plain JSON readable by every
 * accessInfo consumer (briefings, portal payloads, admin list responses). The
 * door code now lives ONLY in the encrypted Property.accessCode column.
 *
 * Three rules the callers depend on:
 *   1. `buildPropertyAccessInfo` DROPS any stored `codes` key, so every save
 *      scrubs the plaintext from the row it touches. The bulk scrub is
 *      scripts/backfill/backfill-encrypt-access-codes.ts.
 *   2. `resolvePropertyAccessCode` is the only supported way to obtain the
 *      plaintext for the encrypted column — its result goes straight into
 *      encryptSecret() and nowhere else.
 *   3. `pickLegacyAccessCode` is the only sanctioned reader of the legacy JSON,
 *      kept so cleaners are not locked out of un-backfilled rows. It can be
 *      deleted once the backfill has run everywhere and no row has `codes`.
 *
 * The update path MUST merge over the stored row. A PATCH body only carries
 * the keys the calling form manages, and the v2 property detail sends just the
 * five text fields — rebuilding accessInfo from the body alone reset
 * laundryTeamUserIds and attachments to [] on every save, silently wiping each
 * property's laundry allocation.
 */

export type PropertyAccessAttachment = {
  name: string;
  url: string;
  key?: string;
  contentType?: string;
};

export type NormalizedPropertyAccessInfo = Record<string, unknown> & {
  lockbox: string;
  instructions: string;
  other: string;
  parking: string;
  laundryTeamUserIds: string[];
  attachments: PropertyAccessAttachment[];
  accessNotesSummary: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read a legacy plaintext door code out of a stored accessInfo blob.
 *
 * Rows written before `codes` was removed still carry it, and a property whose
 * code only ever lived in that JSON has nothing in the encrypted column yet.
 * Readers fall back to this so no cleaner is locked out mid-migration; it
 * returns null once the row has been backfilled and scrubbed.
 */
export function pickLegacyAccessCode(accessInfo: unknown): string | null {
  const value = asRecord(accessInfo).codes;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve the plaintext door code destined for the ENCRYPTED
 * Property.accessCode column.
 *
 * Prefers the flat `accessCode` field the forms send, then the legacy
 * `accessInfo.codes` JSON, so a property whose code only ever lived in the JSON
 * is carried into the encrypted column rather than silently blanked on its
 * next save.
 *
 * The return value is PLAINTEXT. Its only legitimate consumer is
 * encryptSecret() — never persist it anywhere else.
 *
 * @param input  the parsed request body
 * @param stored the property's current accessInfo JSON; omit on create
 * @returns the resolved code, or "" when the caller supplied none
 */
export function resolvePropertyAccessCode(
  input: Record<string, unknown>,
  stored?: unknown
): string {
  const merged = { ...asRecord(stored), ...asRecord(input.accessInfo) };
  return trimmedString(input.accessCode) || pickLegacyAccessCode(merged) || "";
}

/**
 * Merge the requested accessInfo over what is already stored and normalise it.
 *
 * @param input  the parsed request body (accessInfo plus the flat accessCode /
 *               keyLocation / accessNotes columns that feed into it)
 * @param stored the property's current accessInfo JSON; omit on create. Keys
 *               absent from `input.accessInfo` are carried over from here, so
 *               a partial save never drops data it does not manage — with the
 *               single exception of `codes`, which is always dropped.
 */
export function buildPropertyAccessInfo(
  input: Record<string, unknown>,
  stored?: unknown
): NormalizedPropertyAccessInfo {
  // `codes` is destructured out and never written back: the door code belongs
  // in the encrypted Property.accessCode column alone. Dropping it here is what
  // makes every save scrub the plaintext from the row it touches. Callers that
  // need the value for encryption use resolvePropertyAccessCode() instead.
  const { codes, ...accessInfo } = {
    ...asRecord(stored),
    ...asRecord(input.accessInfo),
  };

  const keyLocation = trimmedString(input.keyLocation) || trimmedString(accessInfo.lockbox);
  const instructions = trimmedString(accessInfo.instructions);
  const other = trimmedString(accessInfo.other);
  const accessNotesParts = [trimmedString(input.accessNotes), instructions, other].filter(Boolean);

  return {
    ...accessInfo,
    lockbox: keyLocation,
    instructions,
    other,
    parking: trimmedString(accessInfo.parking),
    laundryTeamUserIds: Array.isArray(accessInfo.laundryTeamUserIds)
      ? accessInfo.laundryTeamUserIds.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0
        )
      : [],
    attachments: Array.isArray(accessInfo.attachments)
      ? (accessInfo.attachments as PropertyAccessAttachment[])
      : [],
    accessNotesSummary: accessNotesParts.join("\n\n"),
  };
}
