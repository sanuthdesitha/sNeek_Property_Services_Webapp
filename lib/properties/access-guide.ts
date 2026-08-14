import { z } from "zod";

/**
 * The per-property ACCESS GUIDE entry model — one shared definition.
 *
 * The kinds list and entry schema were previously copy-pasted across both API
 * routes and both editors, so adding a kind meant editing eight files and
 * hoping none drifted. (Duplicating a property-JSON helper is exactly what
 * caused the laundry-allocation wipe — see lib/properties/access-info.ts.)
 *
 * ── ACCESS-2 / ACCESS-1 boundary ──────────────────────────────────────────
 * ACCESS-2 asks for bin room + bin chute with "location, photos, level, access
 * notes", and notes it likely shares ACCESS-1's waypoint model. Photos and
 * access notes already existed here as `images` and `instructions`. Rather than
 * invent a bins-only structure that ACCESS-1 would later duplicate, the three
 * genuinely new fields are added to the SHARED entry as optional:
 *
 *   level        — which floor/level to go to ("Basement 2", "Ground")
 *   lat / lng    — a map pin for this specific waypoint
 *   sequence     — 1-based visit order
 *
 * `sequence` is deliberately here rather than in a separate ACCESS-1 model: an
 * animated route "showing where to go in sequence" is an ordering OF these
 * waypoints, not a parallel list of them. Every field is optional, so existing
 * stored entries stay valid and nothing has to be backfilled.
 */

export const ACCESS_GUIDE_KINDS = [
  "LOCKBOX",
  "KEYS",
  "ENTRY",
  "ALARM",
  "PARKING",
  "BIN_ROOM",
  /** ACCESS-2 — the chute is a different place from the bin room. */
  "BIN_CHUTE",
  "SUPPLIES_CUPBOARD",
  "WIFI",
  "OTHER",
] as const;

export type AccessGuideKind = (typeof ACCESS_GUIDE_KINDS)[number];

/** Human labels, so every surface names a kind the same way. */
export const ACCESS_GUIDE_KIND_LABELS: Record<AccessGuideKind, string> = {
  LOCKBOX: "Lockbox",
  KEYS: "Keys",
  ENTRY: "Entry",
  ALARM: "Alarm",
  PARKING: "Parking",
  BIN_ROOM: "Bin room",
  BIN_CHUTE: "Bin chute",
  SUPPLIES_CUPBOARD: "Supplies cupboard",
  WIFI: "Wi-Fi",
  OTHER: "Other",
};

export const accessGuideImageSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  key: z.string().trim().min(1).max(1024),
  caption: z.string().trim().max(280).optional(),
});

export const accessGuideEntrySchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(ACCESS_GUIDE_KINDS),
  label: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4000).optional(),
  images: z.array(accessGuideImageSchema).max(24).default([]),
  /** Floor/level to go to. Free text — "B2", "Ground", "Level 3" all occur. */
  level: z.string().trim().max(60).optional(),
  /** Where it is, in words, when a pin is overkill ("behind the lift lobby"). */
  locationNote: z.string().trim().max(280).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** 1-based visit order for the guided route. */
  sequence: z.number().int().min(1).max(99).optional(),
});

export type AccessGuideEntry = z.infer<typeof accessGuideEntrySchema>;

export const accessGuideSaveSchema = z.object({
  accessGuide: z.array(accessGuideEntrySchema).max(40),
});

/**
 * Normalise stored JSON into a clean array, dropping anything unrecognisable.
 *
 * Defensive on purpose: this column has been written by several generations of
 * code (onboarding approval, the v1 editor, the v2 editor), so a single bad
 * entry must not blank a cleaner's whole access guide.
 */
export function sanitizeAccessGuide(value: unknown): AccessGuideEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AccessGuideEntry[] = [];
  for (const raw of value) {
    const parsed = accessGuideEntrySchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** True when this entry can be put on a map. */
export function hasWaypoint(entry: Pick<AccessGuideEntry, "lat" | "lng">): boolean {
  return typeof entry.lat === "number" && typeof entry.lng === "number";
}

/**
 * The guided route: entries carrying a `sequence`, in order.
 *
 * Entries without one are NOT invented into the route — a made-up order is
 * worse than none when someone is following it around a building at 7am.
 * Ties break on the original array order so the result is deterministic.
 */
export function orderedRoute(entries: readonly AccessGuideEntry[]): AccessGuideEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter((row) => typeof row.entry.sequence === "number")
    .sort((a, b) => a.entry.sequence! - b.entry.sequence! || a.index - b.index)
    .map((row) => row.entry);
}

/** Drop entries that carry nothing useful, and trim empty optional strings. */
export function cleanAccessGuideForSave(entries: readonly AccessGuideEntry[]): AccessGuideEntry[] {
  return entries
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      instructions: entry.instructions?.trim() || undefined,
      images: entry.images.map((img) => ({
        url: img.url,
        key: img.key,
        caption: img.caption?.trim() || undefined,
      })),
      level: entry.level?.trim() || undefined,
      locationNote: entry.locationNote?.trim() || undefined,
      lat: entry.lat,
      lng: entry.lng,
      sequence: entry.sequence,
    }))
    .filter(
      (entry) =>
        entry.label ||
        entry.instructions ||
        entry.images.length > 0 ||
        entry.level ||
        entry.locationNote
    );
}
