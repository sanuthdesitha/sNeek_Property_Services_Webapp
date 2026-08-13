/**
 * Property.accessInfo normalisation, shared by the admin property create
 * (POST /api/admin/properties) and update (PATCH /api/admin/properties/:id)
 * routes, which previously carried identical private copies of this logic.
 *
 * Property.accessInfo is a free-form JSON column holding:
 *   lockbox, codes, parking, other, instructions  (strings, edited by admin)
 *   accessNotesSummary                            (derived, for cleaner briefs)
 *   laundryTeamUserIds: string[]                  (laundry allocation)
 *   attachments: {name,url,key?,contentType?}[]   (access photos/PDFs)
 *   defaultCleanDurationHours, maxGuestCount      (set at onboarding)
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
  codes: string;
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
 * Merge the requested accessInfo over what is already stored and normalise it.
 *
 * @param input  the parsed request body (accessInfo plus the flat accessCode /
 *               keyLocation / accessNotes columns that feed into it)
 * @param stored the property's current accessInfo JSON; omit on create. Keys
 *               absent from `input.accessInfo` are carried over from here, so
 *               a partial save never drops data it does not manage.
 */
export function buildPropertyAccessInfo(
  input: Record<string, unknown>,
  stored?: unknown
): NormalizedPropertyAccessInfo {
  const accessInfo = { ...asRecord(stored), ...asRecord(input.accessInfo) };

  const codeValue = trimmedString(input.accessCode) || trimmedString(accessInfo.codes);
  const keyLocation = trimmedString(input.keyLocation) || trimmedString(accessInfo.lockbox);
  const instructions = trimmedString(accessInfo.instructions);
  const other = trimmedString(accessInfo.other);
  const accessNotesParts = [trimmedString(input.accessNotes), instructions, other].filter(Boolean);

  return {
    ...accessInfo,
    lockbox: keyLocation,
    codes: codeValue,
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
