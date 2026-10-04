/** A committed cleaner update, not a claim of provider delivery. */
export type SavedCleanerLaundryUpdate = {
  id: string;
  recordedAt: string;
  outcome: "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
  bagLocation: string;
  bagCount: string;
  photoKey: string | null;
  photoUrl: string | null;
  skipCode: string;
  skipNote: string;
};

export function savedCleanerLaundryUpdate(rows: Array<{
  id: string; createdAt: Date | string; notes: string | null;
  bagLocation: string | null; s3Key?: string | null; photoUrl?: string | null;
}>): SavedCleanerLaundryUpdate | null {
  const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id.localeCompare(a.id));
  for (const row of sorted) {
    let meta;
    try { meta = JSON.parse(row.notes ?? "null"); } catch { continue; }
    if (!meta || !["EARLY_UPDATE", "FINAL_SUBMISSION"].includes(meta.source) ||
      !["READY_FOR_PICKUP", "NOT_READY", "NO_PICKUP_REQUIRED"].includes(meta.laundryOutcome)) continue;
    if (!Number.isFinite(new Date(row.createdAt).getTime())) continue;
    return {
      id: row.id, recordedAt: new Date(row.createdAt).toISOString(), outcome: meta.laundryOutcome,
      bagLocation: row.bagLocation ?? "", photoKey: row.s3Key ?? null, photoUrl: row.photoUrl ?? null,
      bagCount: meta.laundryOutcome === "READY_FOR_PICKUP" && meta.unit === "bags" && Number.isInteger(meta.bagCount) && meta.bagCount >= 1 && meta.bagCount <= 50 ? String(meta.bagCount) : "",
      skipCode: typeof meta.reasonCode === "string" && meta.reasonCode ? meta.reasonCode : "LINEN_STILL_WASHING",
      skipNote: typeof meta.reasonNote === "string" ? meta.reasonNote : "",
    };
  }
  return null;
}

export function savedLaundrySignature(update: SavedCleanerLaundryUpdate) {
  return JSON.stringify({ laundryOutcome: update.outcome, bagLocation: update.bagLocation.trim(),
    bagCount: update.bagCount, photoKey: update.photoKey,
    skipCode: update.outcome === "READY_FOR_PICKUP" ? null : update.skipCode, skipNote: update.skipNote.trim() });
}
