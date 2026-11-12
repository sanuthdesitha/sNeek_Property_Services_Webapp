/**
 * "Last seen" for every signed-in person (Wave E, 2026-11).
 *
 * Called from the live session guards with the GENUINE signed-in user's id —
 * never an impersonated target's: while an admin is "testing as" someone,
 * the admin is the one active, and the target has not been seen.
 *
 * Throttled so authenticated requests do not each write: at most one write per
 * person per `LAST_SEEN_WRITE_INTERVAL_MS` from this process (an in-memory
 * stamp), and the UPDATE itself only matches when the stored value is null or
 * older than the interval, so several app instances also write at most about
 * once per interval. A failure is swallowed: recording presence must never
 * refuse or slow a request, and the stored value simply stays older.
 */
import { db } from "@/lib/db";

export const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TRACKED_PEOPLE = 5000;

type LastSeenWriter = { user: { updateMany: (args: { where: object; data: { lastSeenAt: Date } }) => Promise<unknown> } };

const globalStore = globalThis as typeof globalThis & { __sneekLastSeenWrites?: Map<string, number> };
const recentWrites: Map<string, number> = globalStore.__sneekLastSeenWrites ?? new Map<string, number>();
globalStore.__sneekLastSeenWrites = recentWrites;

export type LastSeenOutcome = "written" | "throttled" | "failed";

/** Test hook: forget the in-memory stamps. */
export function resetLastSeenThrottle(): void {
  recentWrites.clear();
}

export async function recordLastSeen(userId: string, now: Date = new Date(), client: LastSeenWriter = db as unknown as LastSeenWriter): Promise<LastSeenOutcome> {
  if (!userId) return "throttled";
  const nowMs = now.getTime();
  const previous = recentWrites.get(userId);
  if (previous !== undefined && nowMs - previous < LAST_SEEN_WRITE_INTERVAL_MS) return "throttled";
  if (recentWrites.size >= MAX_TRACKED_PEOPLE) recentWrites.clear();
  recentWrites.set(userId, nowMs);
  try {
    await client.user.updateMany({
      where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(nowMs - LAST_SEEN_WRITE_INTERVAL_MS) } }] },
      data: { lastSeenAt: now },
    });
    return "written";
  } catch {
    return "failed";
  }
}
