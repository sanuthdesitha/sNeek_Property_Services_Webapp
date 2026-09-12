// Tab-local navigation hints only; never used for authorization or job data.
export const JOBS_SCROLL_STORAGE_KEY = "sneek:jobs-scroll:v1";
export const JOBS_SCROLL_MAX_AGE = 30 * 60_000;
export type JobsScrollPosition = {
  scope: string; content: string; x: number; y: number; width: number; height: number; savedAt: number;
};
export function readJobsScrollPositions(raw: string | null, now = Date.now()): JobsScrollPosition[] {
  try {
    if (!raw || raw.length > 200_000) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.slice(0, 20).filter((value): value is JobsScrollPosition => {
      if (!value || typeof value !== "object") return false;
      const row = value as Record<string, unknown>;
      return typeof row.scope === "string" && row.scope.length <= 5000 && typeof row.content === "string" && row.content.length <= 200
        && ["x", "y", "width", "height", "savedAt"].every(key => typeof row[key] === "number" && Number.isFinite(row[key]))
        && Number(row.x) >= 0 && Number(row.y) >= 0 && Number(row.x) <= 10_000_000 && Number(row.y) <= 10_000_000
        && Number(row.width) > 0 && Number(row.height) > 0 && Number(row.savedAt) <= now && now - Number(row.savedAt) <= JOBS_SCROLL_MAX_AGE;
    });
  } catch { return []; }
}
export function jobsScrollContentFingerprint(value: string): string {
  // A layout-change detector, not a security token. Store no job record payloads.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `${value.length}:${hash >>> 0}`;
}
