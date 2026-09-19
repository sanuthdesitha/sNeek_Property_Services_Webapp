export function orderStorageKey(userId: string, isoDate: string): string {
  return `sneek_route_order_${userId}_${isoDate}`;
}

export function loadStoredOrder(userId: string, isoDate: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(orderStorageKey(userId, isoDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

export function saveStoredOrder(userId: string, isoDate: string, jobIds: string[]): void {
  try {
    window.localStorage.setItem(orderStorageKey(userId, isoDate), JSON.stringify(jobIds));
  } catch {
    /* storage unavailable — order simply isn't persisted */
  }
}

export function clearStoredOrder(userId: string, isoDate: string): void {
  try {
    window.localStorage.removeItem(orderStorageKey(userId, isoDate));
  } catch {
    /* ignore */
  }
}

/** Reorder `stops` to follow a stored jobId order; unknown/new stops keep their
 *  suggested position at the end. Pure — safe for SSR (never touches storage). */
export function applyStoredOrder<T extends { jobId: string }>(stops: T[], jobIds: string[] | null): T[] {
  if (!jobIds || jobIds.length === 0) return stops;
  const byId = new Map(stops.map((s) => [s.jobId, s]));
  const ordered: T[] = [];
  const used = new Set<string>();
  for (const id of jobIds) {
    const stop = byId.get(id);
    if (stop && !used.has(id)) {
      ordered.push(stop);
      used.add(id);
    }
  }
  for (const stop of stops) if (!used.has(stop.jobId)) ordered.push(stop);
  return ordered;
}
