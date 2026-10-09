type Position = {
  userId: string;
  lat: number | null;
  lng: number | null;
  timestamp: string | null;
  lastPingAt?: string | null;
  accuracy?: number | null;
};

/** Snapshot establishes active-work membership; raw GPS only updates known workers. */
export function mergeTrackedPosition<T extends Position>(rows: T[], incoming: Position): T[] {
  const index = rows.findIndex(row => row.userId === incoming.userId);
  const measured = Date.parse(incoming.timestamp ?? "");
  if (index < 0 || !Number.isFinite(measured)) return rows;
  const current = rows[index];
  const previous = Date.parse(current.lastPingAt ?? current.timestamp ?? "");
  if (Number.isFinite(previous) && measured <= previous) return rows;
  const next = rows.slice();
  next[index] = {
    ...current,
    lat: incoming.lat,
    lng: incoming.lng,
    accuracy: incoming.accuracy ?? current.accuracy,
    timestamp: incoming.timestamp,
    lastPingAt: incoming.timestamp,
    positionSource: "gps",
    stale: false,
  };
  return next;
}
