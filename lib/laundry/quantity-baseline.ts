export type QuantityConfirmation = { id?: string; confirmedById?: string; createdAt?: Date | string; photoUrl?: string | null; s3Key?: string | null; notes?: string | null };
export function recordedCleanerReadiness(confirmations: QuantityConfirmation[]) {
  for (const row of [...confirmations].reverse()) {
    let meta: any; try { meta = JSON.parse(row.notes ?? "null"); } catch { continue; }
    if (!meta || !["EARLY_UPDATE", "FINAL_SUBMISSION"].includes(meta.source)) continue;
    return meta.laundryOutcome === "READY_FOR_PICKUP" ? row : null;
  }
  return null;
}
/** Only an explicit cleaner readiness record establishes expected bags. */
export function cleanerBagBaseline(confirmations: QuantityConfirmation[]) {
  for (const row of [...confirmations].reverse()) {
    let meta: any; try { meta = JSON.parse(row.notes ?? "null"); } catch { continue; }
    if (!meta || !["EARLY_UPDATE", "FINAL_SUBMISSION"].includes(meta.source)) continue;
    if (meta.laundryOutcome !== "READY_FOR_PICKUP") return null;
    if (meta.unit !== "bags" || !Number.isInteger(meta.bagCount) || meta.bagCount < 1 || meta.bagCount > 50) return null;
    return { count: meta.bagCount as number, unit: "bags" as const, confirmationId: row.id ?? null, actorId: row.confirmedById ?? null, recordedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null, photoUrl: row.photoUrl ?? null, photoKey: row.s3Key ?? null };
  }
  return null;
}
