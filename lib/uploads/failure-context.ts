/**
 * Plain summary of the diagnostics a failed cleaner video records, so the
 * office can see whether a phone stalled on a slow connection, lost its
 * connection, or was refused. Returns null for rows without video diagnostics.
 */
export function describeUploadContext(context: unknown): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const value = context as Record<string, unknown>;
  if (value.kind !== "video") return null;
  const parts: string[] = [];
  if (typeof value.speedKbps === "number") parts.push(`${value.speedKbps} kbps measured`);
  if (typeof value.partsDone === "number" && typeof value.partsTotal === "number") parts.push(`parts ${value.partsDone}/${value.partsTotal}`);
  if (typeof value.failure === "string") parts.push(value.failure);
  if (typeof value.stalls === "number" && value.stalls > 0) parts.push(`${value.stalls} stall${value.stalls === 1 ? "" : "s"}`);
  if (typeof value.lastStatus === "number") parts.push(`HTTP ${value.lastStatus}`);
  if (typeof value.route === "string") parts.push(value.route === "proxy" ? "via app server" : "direct to storage");
  if (typeof value.effectiveType === "string") parts.push(`network ${value.effectiveType}`);
  if (value.online === false) parts.push("offline");
  if (typeof value.encoding === "string") parts.push(value.encoding.replaceAll("_", " "));
  return parts.length ? parts.join(" · ") : null;
}
