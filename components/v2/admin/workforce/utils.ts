/**
 * Shared, framework-free helpers for the Estate Workforce hub. Safe to import
 * from both server pages and client boards (no React, no DB).
 */
export type DocExpiryStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "NONE";

const DAY = 24 * 60 * 60 * 1000;

/** Classify a document's expiry against a rolling 14-day soon-window. */
export function docExpiryStatus(expiresAt: string | Date | null | undefined, now = Date.now()): DocExpiryStatus {
  if (!expiresAt) return "NONE";
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return "NONE";
  if (t < now) return "EXPIRED";
  if (t <= now + 14 * DAY) return "EXPIRING_SOON";
  return "ACTIVE";
}

/** Turn UPPER_SNAKE or slug_case keys into a readable label. */
export function prettify(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Tone for a document status pill (maps to EBadge tones). */
export function docStatusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const s = status.toUpperCase();
  if (s === "VERIFIED" || s === "SIGNED") return "success";
  if (s === "REJECTED" || s === "EXPIRED") return "danger";
  if (s === "PENDING") return "warning";
  return "neutral";
}

/** Compact relative "last seen" string; online if within 5 min. */
export function lastSeenLabel(lastSeenAt: string | Date | null | undefined, now = Date.now()): { label: string; online: boolean } {
  if (!lastSeenAt) return { label: "No sign-in", online: false };
  const t = new Date(lastSeenAt).getTime();
  if (Number.isNaN(t)) return { label: "No sign-in", online: false };
  const diff = now - t;
  if (diff < 5 * 60 * 1000) return { label: "Online now", online: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { label: `${mins}m ago`, online: false };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { label: `${hrs}h ago`, online: false };
  const days = Math.floor(hrs / 24);
  if (days < 30) return { label: `${days}d ago`, online: false };
  return { label: new Date(t).toLocaleDateString("en-AU"), online: false };
}
